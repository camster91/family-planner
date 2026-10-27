"use client";
import * as React from "react";
import { BulkRecoveryProvider } from "./recovery/BulkRecoveryContext";
import { useBulkRecovery } from "./recovery/useBulkRecovery";
import { BulkRecoveryShelf } from "./recovery/BulkRecoveryShelf";
import type { PrepDraft } from "@/lib/meal-prep-recovery/draft-contract";
import { useOwnedDraftExit } from "@/components/layout/owned-draft-navigation";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { navigateAfterOwnedDrafts } from "@/lib/owned-draft-exit";
import Link from "next/link";
import {
  resolvePreparedReuse,
  type PreparedReuseIntent,
} from "@/lib/prepared-meal-reuse";
import { useBulkCookingText } from "@/i18n/bulk-cooking";
import { useDisplayLocale } from "@/components/ui/use-display-locale";
import {
  batchPortionCounts,
  mealPrepListSchema,
  type MealPrepContext,
  type MealPrepSummary,
} from "@/lib/meal-batches";
import { parseDateOnly, toDateOnlyUTC } from "@/lib/dates";
import { AddToGroceriesButton } from "./AddToGroceriesButton";
import { MealPrepEditor } from "./MealPrepEditor";
import { RecipeReuseLauncher } from "./RecipeReuseLauncher";
import type { RecipeOption } from "./RecipePicker";
import { PreparedRecipe } from "./PreparedRecipe";
import {
  MealPrepActionSheet,
  type PrepActionKind,
} from "./MealPrepActionSheet";

export function BulkCookingPanel({
  defaultDay,
  refreshKey,
  onMealsChanged,
  onContext,
  reuseRecipeId,
  onDismissReuse,
  preparedReuse = { state: "none" },
  onDismissPreparedReuse,
  personalRecoveryAllowed = true,
  recoveryRequested = false,
}: {
  defaultDay: string;
  refreshKey: unknown;
  onMealsChanged: () => void;
  onContext: (scope: MealPrepContext | null) => void;
  reuseRecipeId?: string | null;
  onDismissReuse?: () => void;
  preparedReuse?: PreparedReuseIntent;
  onDismissPreparedReuse?: () => void;
  personalRecoveryAllowed?: boolean;
  recoveryRequested?: boolean;
}) {
  const tBulk = useBulkCookingText();
  const locale = useDisplayLocale();
  const id = React.useId();
  const reuseKey =
    preparedReuse.state === "target"
      ? `${preparedReuse.target.sessionId}/${preparedReuse.target.batchId}`
      : preparedReuse.state;
  const reuseRef = React.useRef(preparedReuse);
  reuseRef.current = preparedReuse;
  const handledReuse = React.useRef<string | null>(null);
  const previousReuse = React.useRef<string | null>(null);
  const [reuseProblem, setReuseProblem] = React.useState<
    "unavailable" | "unprepared" | "full" | null
  >(null);

  const [sessions, setSessions] = React.useState<MealPrepSummary[]>([]);
  const [scope, setScope] = React.useState<MealPrepContext | null>(null);
  const scopeRef = React.useRef<MealPrepContext | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const selectedRef = React.useRef(selected);
  selectedRef.current = selected;
  const preferredSession = React.useRef<string | null>(null);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [forbidden, setForbidden] = React.useState(false);
  const [editor, setEditor] = React.useState<{
    day: string;
    seed?: MealPrepSummary;
    recipe?: RecipeOption;
    restoredDraft?: Extract<PrepDraft, { kind: "create" }>;
  } | null>(null);
  const [modal, setModal] = React.useState<{
    kind: PrepActionKind;
    sessionId: string;
    batchId?: string;
    consumptionId?: string;
    restoredDraft?: Extract<PrepDraft, { kind: "action" }>;
  } | null>(null);
  const [restoreError, setRestoreError] = React.useState(false);
  const afterOwnedSave = React.useRef<
    (receipt: import("@/lib/meal-prep-recovery/contract").PrepReceipt) => void
  >(() => undefined);
  const recovery = useBulkRecovery(
    personalRecoveryAllowed ? scope : null,
    (receipt) => afterOwnedSave.current(receipt),
    personalRecoveryAllowed && recoveryRequested,
  );
  React.useEffect(() => {
    if (!personalRecoveryAllowed) {
      setEditor(null);
      setModal(null);
    }
  }, [personalRecoveryAllowed]);
  const ownedActive =
    recovery.mode === "owned" &&
    (recovery.active || recovery.busy || recovery.issue === "storage");
  const latestRecovery = React.useRef(recovery);
  latestRecovery.current = recovery;
  const recoveryBack = React.useRef<(() => boolean) | null>(null);
  const rememberRecoveryBack = React.useCallback((handler: () => boolean) => {
    recoveryBack.current = handler;
  }, []);
  const ownedNavigation = usePendingFormNavigationController(ownedActive, {
    warnOnUnload:
      recovery.busy || recovery.dirty || recovery.issue === "storage",
    onBack: () => {
      if (recoveryBack.current?.()) return;
      void navigateAfterOwnedDrafts(() => {
        setEditor(null);
        setModal(null);
      });
    },
  });
  useOwnedDraftExit(
    ownedActive,
    () => latestRecovery.current.prepareLeave(),
    () => ownedNavigation.releaseBeforeNavigation(),
  );
  const request = React.useRef(0);
  const onContextRef = React.useRef(onContext);
  onContextRef.current = onContext;
  const load = React.useCallback(
    async (next?: string): Promise<MealPrepSummary[] | null> => {
      const version = ++request.current;
      const requestedReuse = reuseRef.current;
      setLoading(true);
      setError(false);
      try {
        const response = await fetch(
          `/api/meals/bulk${next ? `?cursor=${encodeURIComponent(next)}` : ""}`,
          { cache: "no-store" },
        );
        if ([401, 403].includes(response.status)) {
          if (version === request.current) {
            setForbidden(true);
            setSessions([]);
            setScope(null);
            scopeRef.current = null;
            onContextRef.current(null);
            setSelected(null);
            preferredSession.current = null;
            setCursor(null);
            setEditor(null);
            setModal(null);
          }
          return null;
        }
        if (!response.ok) throw new Error("Prep sessions unavailable");
        const data = mealPrepListSchema.parse(await response.json());
        if (version !== request.current) return null;
        const changedOwner =
          scopeRef.current &&
          (scopeRef.current.familyId !== data.context.familyId ||
            scopeRef.current.userId !== data.context.userId);
        const target =
          preferredSession.current ??
          (requestedReuse.state === "target"
            ? requestedReuse.target.sessionId
            : null) ??
          selectedRef.current;
        let visible = data.sessions;
        if (
          !next &&
          !changedOwner &&
          target &&
          !visible.some((row) => row.id === target)
        ) {
          const detailResponse = await fetch(
            `/api/meals/bulk?sessionId=${encodeURIComponent(target)}`,
            { cache: "no-store" },
          );
          if ([401, 403].includes(detailResponse.status)) {
            if (version === request.current) {
              setForbidden(true);
              setSessions([]);
              setScope(null);
              scopeRef.current = null;
              onContextRef.current(null);
              setEditor(null);
              setModal(null);
              setSelected(null);
              preferredSession.current = null;
              setCursor(null);
            }
            return null;
          }
          if (detailResponse.ok) {
            const detail = mealPrepListSchema.parse(
              await detailResponse.json(),
            );
            if (
              detail.context.familyId !== data.context.familyId ||
              detail.context.userId !== data.context.userId
            )
              throw new Error("Changed account");
            visible = [...visible, ...detail.sessions];
          } else if (detailResponse.status !== 404)
            throw new Error("Selected prep unavailable");
        }
        if (version !== request.current) return null;
        if (changedOwner) {
          setEditor(null);
          setModal(null);
          setSelected(null);
        }
        scopeRef.current = data.context;
        setScope(data.context);
        onContextRef.current(data.context);
        setForbidden(false);
        setSessions((previous) =>
          next && !changedOwner
            ? [
                ...previous.filter(
                  (row) => !visible.some((newRow) => newRow.id === row.id),
                ),
                ...visible,
              ]
            : visible,
        );
        setCursor(data.nextCursor);
        if (!next || changedOwner)
          setSelected((value) =>
            !changedOwner && target && visible.some((row) => row.id === target)
              ? target
              : visible.some((row) => row.id === value)
                ? value
                : (visible[0]?.id ?? null),
          );
        if (
          preferredSession.current &&
          visible.some((row) => row.id === preferredSession.current)
        )
          preferredSession.current = null;
        return visible;
      } catch {
        if (version === request.current) setError(true);
        return null;
      } finally {
        if (version === request.current) setLoading(false);
      }
    },
    [],
  );
  React.useEffect(() => {
    if (previousReuse.current !== reuseKey) {
      previousReuse.current = reuseKey;
      handledReuse.current = null;
      setReuseProblem(null);
      preferredSession.current =
        reuseRef.current.state === "target"
          ? reuseRef.current.target.sessionId
          : null;
    }
    void load();
  }, [load, refreshKey, reuseKey]);
  React.useEffect(() => {
    if (
      !personalRecoveryAllowed ||
      loading ||
      error ||
      preparedReuse.state !== "target" ||
      handledReuse.current === reuseKey ||
      modal ||
      editor ||
      recovery.draft ||
      recovery.held ||
      (recovery.mode !== "legacy" &&
        (recovery.mode !== "owned" || !recovery.context?.enabled))
    )
      return;
    const resolved = resolvePreparedReuse(sessions, preparedReuse.target);
    if (resolved.state !== "ready") {
      setReuseProblem(resolved.state);
      return;
    }
    handledReuse.current = reuseKey;
    setReuseProblem(null);
    setSelected(resolved.session.id);
    setModal({
      kind: "allocate",
      sessionId: resolved.session.id,
      batchId: resolved.batch.id,
    });
  }, [
    personalRecoveryAllowed,
    loading,
    error,
    reuseKey,
    sessions,
    modal,
    editor,
    recovery.mode,
    recovery.draft,
    recovery.held,
    recovery.context?.enabled,
    preparedReuse,
  ]);
  React.useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const formatDay = (value: string) =>
    parseDateOnly(toDateOnlyUTC(value))!.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  const current = sessions.find((row) => row.id === selected) ?? sessions[0];
  const modalSession =
    modal && sessions.find((row) => row.id === modal.sessionId);
  const sessionCounts = current
    ? current.batches.reduce(
        (totals, batch) => {
          const counts = batchPortionCounts(
            batch.total_servings,
            batch.meals,
            batch.consumption,
          );
          return {
            total: totals.total + batch.total_servings,
            eaten: totals.eaten + counts.eaten,
            remaining: totals.remaining + counts.remaining,
            planned: totals.planned + counts.planned,
            unplanned: totals.unplanned + counts.unplanned,
          };
        },
        { total: 0, eaten: 0, remaining: 0, planned: 0, unplanned: 0 },
      )
    : null;
  const formScope =
    scope ??
    (recoveryRequested && recovery.context
      ? { userId: recovery.context.userId, familyId: recovery.context.familyId }
      : null);
  // Keep a previously loaded session visible for recovery, but do not let a
  // refresh error or in-flight reload start a new mutation from stale data.
  // Existing editors/action sheets stay mounted so their pending/unknown
  // receipt hooks can still finish or retry against the original request.
  const recoveryBlocked =
    recovery.mode !== "legacy" &&
    (recovery.mode !== "owned" ||
      recovery.held ||
      !recovery.context?.enabled ||
      (recovery.draft !== null && !recovery.active));
  const mutationsBlocked =
    !personalRecoveryAllowed || loading || error || recoveryBlocked;
  afterOwnedSave.current = (receipt) => {
    if ("sessionId" in receipt) preferredSession.current = receipt.sessionId;
    void load();
    onMealsChanged();
  };
  async function restoreDraft() {
    const draft = recovery.draft;
    setRestoreError(false);
    if (
      !draft ||
      recovery.busy ||
      recovery.active ||
      !recovery.context?.enabled ||
      !(await recovery.prepareLeave())
    )
      return;
    if (draft.kind === "create") {
      setEditor({ day: draft.day, restoredDraft: draft });
      return;
    }
    preferredSession.current = draft.sessionId;
    const latest = await load();
    const session = latest?.find((row) => row.id === draft.sessionId),
      batch = session?.batches.find((row) => row.id === draft.batchId);
    if (
      !session ||
      (draft.batchId && !batch) ||
      (draft.consumptionId &&
        !batch?.consumption.some((row) => row.id === draft.consumptionId)) ||
      ((draft.action === "allocate" || draft.action === "eaten") &&
        batch?.portions_complete !== true) ||
      (draft.requirePrepared && !session.prepared_at) ||
      !(await recovery.prepareLeave())
    ) {
      setRestoreError(true);
      return;
    }
    setSelected(session.id);
    setModal({
      kind: draft.action,
      sessionId: session.id,
      ...(batch ? { batchId: batch.id } : {}),
      ...(draft.consumptionId ? { consumptionId: draft.consumptionId } : {}),
      restoredDraft: draft,
    });
  }
  const saved = (sessionId?: string) => {
    if (sessionId) preferredSession.current = sessionId;
    setEditor(null);
    setModal(null);
    if (reuseRef.current.state !== "none") onDismissPreparedReuse?.();
    void load().then((latest) => {
      if (sessionId && latest?.some((row) => row.id === sessionId))
        setSelected(sessionId);
    });
    onMealsChanged();
  };
  return (
    <BulkRecoveryProvider value={recovery}>
      <section
        aria-labelledby={`${id}-title`}
        className="rounded-2xl border border-[var(--surface-separator)] bg-[var(--surface-grouped)] p-4 sm:p-5 space-y-4"
        data-testid="bulk-cooking-panel"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="text-title-2 font-display">
            {tBulk("title")}
          </h2>
          <button
            type="button"
            className="btn-filled min-h-[44px]"
            disabled={!scope || forbidden || mutationsBlocked}
            onClick={() => setEditor({ day: defaultDay })}
          >
            {tBulk("add")}
          </button>
        </div>
        {personalRecoveryAllowed && (scope || recoveryRequested) && (
          <BulkRecoveryShelf
            recovery={recovery}
            requested={recoveryRequested}
            onRestore={() => void restoreDraft()}
            restoreError={restoreError}
            onBackHandler={rememberRecoveryBack}
            onReloadStored={() =>
              void recovery.reloadStored(() => {
                setEditor(null);
                setModal(null);
              })
            }
          />
        )}
        {(preparedReuse.state === "invalid" || reuseProblem) && (
          <div
            role="status"
            className="space-y-2 rounded-xl border border-[var(--surface-separator)] p-3"
          >
            <p>
              {tBulk(preparedReuse.state === "invalid" ? "reuseInvalid"
                : reuseProblem === "unprepared" ? "reuseUnprepared"
                  : reuseProblem === "full" ? "reuseFull" : "reuseUnavailable")}
            </p>
            {preparedReuse.state === "target" && (
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={loading}
                onClick={() => void load()}
              >
                {tBulk("reload")}
              </button>
            )}
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              disabled={loading}
              onClick={onDismissPreparedReuse}
            >
              {tBulk("clearReuse")}
            </button>
          </div>
        )}
        {forbidden ? (
          <p className="text-subhead text-label-secondary">
            {tBulk("forbidden")}
          </p>
        ) : error ? (
          <div role="alert" className="space-y-2">
            <p className="text-subhead text-[var(--danger-text)]">
              {tBulk("loadError")}
            </p>
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              onClick={() => void load()}
            >
              {tBulk("reload")}
            </button>
          </div>
        ) : loading && !current ? (
          <p role="status" className="text-subhead text-label-secondary">
            {tBulk("loading")}
          </p>
        ) : !current ? (
          <p className="text-subhead text-label-secondary">{tBulk("empty")}</p>
        ) : null}
        {reuseRecipeId &&
          onDismissReuse &&
          scope &&
          !forbidden &&
          !mutationsBlocked &&
          !editor &&
          !modal && (
            <RecipeReuseLauncher
              recipeId={reuseRecipeId}
              onDismiss={onDismissReuse}
              kind="prep"
              onUse={(recipe) => setEditor({ day: defaultDay, recipe })}
            />
          )}
        {current && !forbidden && (
          <>
            <label className="block text-subhead" htmlFor={`${id}-session`}>
              {tBulk("stepPrep")}
              <select
                id={`${id}-session`}
                className="input-field w-full mt-1"
                value={current.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {sessions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {formatDay(row.prepared_on)} ·{" "}
                    {row.batches.map((batch) => batch.name).join(", ")}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-subhead font-semibold">
                {current.prepared_at ? tBulk("prepared") : tBulk("plannedPrep")}
              </p>
              {!current.prepared_at && (
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  onClick={() =>
                    setModal({ kind: "prepared", sessionId: current.id })
                  }
                  disabled={mutationsBlocked}
                >
                  {tBulk("markPrepared")}
                </button>
              )}
            </div>
            {sessionCounts && (
              <div
                className="rounded-xl bg-[var(--surface-fill)] p-3 space-y-1"
                role="status"
                aria-label={tBulk("sessionSummary")}
              >
                <p className="text-subhead font-semibold">
                  {tBulk("sessionSummary")}
                </p>
                <p className="text-subhead text-label-secondary">
                  {tBulk("total", { count: sessionCounts.total })} ·{" "}
                  {tBulk("eaten", { count: sessionCounts.eaten })} ·{" "}
                  {tBulk("remaining", { count: sessionCounts.remaining })}
                </p>
                <p className="text-footnote text-label-secondary">
                  {tBulk("planned", { count: sessionCounts.planned })} ·{" "}
                  {tBulk("unplanned", { count: sessionCounts.unplanned })}
                </p>
              </div>
            )}
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {current.batches.map((batch) => {
                const counts = batchPortionCounts(
                  batch.total_servings,
                  batch.meals,
                  batch.consumption,
                );
                return (
                  <article
                    key={batch.id}
                    className="rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-4 space-y-3 min-w-0"
                    aria-label={batch.name}
                  >
                    <h3 className="text-headline break-words">{batch.name}</h3>
                    <p
                      className="text-subhead text-label-secondary"
                      role="status"
                    >
                      {tBulk("total", { count: batch.total_servings })} ·{" "}
                      {tBulk("eaten", { count: counts.eaten })} ·{" "}
                      {tBulk("remaining", { count: counts.remaining })}
                    </p>
                    <p className="text-footnote text-label-secondary">
                      {tBulk("planned", { count: counts.planned })} ·{" "}
                      {tBulk("unplanned", { count: counts.unplanned })} ·{" "}
                      {batch.reserve_storage === "freezer"
                        ? tBulk("freezer")
                        : tBulk("fridge")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(batch.recipe_id || batch.recipe_snapshot_at) && (
                        <Link
                          className="btn-tinted min-h-[44px]"
                          aria-disabled={mutationsBlocked}
                          onClick={(event) => {
                            if (mutationsBlocked) event.preventDefault();
                          }}
                          href={`/dashboard/inventory?cookBatch=${encodeURIComponent(batch.id)}`}
                        >
                          {tBulk("reviewFoodUsed")}
                        </Link>
                      )}
                      <button
                        type="button"
                        className="btn-tinted min-h-[44px]"
                        onClick={() =>
                          setModal({
                            kind: "allocate",
                            sessionId: current.id,
                            batchId: batch.id,
                          })
                        }
                        disabled={mutationsBlocked || counts.unplanned <= 0}
                      >
                        {tBulk("schedule")}
                      </button>
                      <button
                        type="button"
                        className="btn-tinted min-h-[44px]"
                        disabled={
                          mutationsBlocked ||
                          !current.prepared_at ||
                          counts.remaining <= 0
                        }
                        onClick={() =>
                          setModal({
                            kind: "eaten",
                            sessionId: current.id,
                            batchId: batch.id,
                          })
                        }
                      >
                        {tBulk("recordEaten")}
                      </button>
                      {batch.consumption[0] && (
                        <button
                          type="button"
                          className="btn-tinted min-h-[44px]"
                          disabled={mutationsBlocked}
                          onClick={() =>
                            setModal({
                              kind: "undo-eaten",
                              sessionId: current.id,
                              batchId: batch.id,
                              consumptionId: batch.consumption[0].id,
                            })
                          }
                        >
                          {tBulk("undoEaten")}
                        </button>
                      )}
                    </div>
                    {current.prepared_at &&
                      (batch.recipe_id || batch.recipe_snapshot_at) && (
                        <PreparedRecipe batchId={batch.id} />
                      )}
                    {batch.recipe_id && !current.prepared_at && (
                      <AddToGroceriesButton
                        recipeId={batch.recipe_id}
                        batchId={batch.id}
                        label={tBulk("groceries")}
                        disabled={mutationsBlocked}
                      />
                    )}
                  </article>
                );
              })}
            </div>
            <div className="rounded-xl bg-[var(--surface-fill)] p-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-subhead">
                <strong>{tBulk("nextPrep")}</strong> ·{" "}
                {current.next_prep_on
                  ? formatDay(current.next_prep_on)
                  : tBulk("noNext")}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-tinted min-h-[44px]"
                  disabled={mutationsBlocked}
                  onClick={() =>
                    setModal({ kind: "next-prep", sessionId: current.id })
                  }
                >
                  {tBulk(current.next_prep_on ? "changeNext" : "setNextDate")}
                </button>
                <button
                  type="button"
                  className="btn-filled min-h-[44px]"
                  disabled={mutationsBlocked}
                  onClick={() =>
                    setEditor({
                      day: current.next_prep_on ? toDateOnlyUTC(current.next_prep_on) : defaultDay,
                      seed: current,
                    })
                  }
                >
                  {tBulk("planNext")}
                </button>
              </div>
            </div>
            <p className="text-footnote text-label-secondary">
              {tBulk("planningNote")}
            </p>
            {cursor && (
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={loading || error}
                onClick={() => void load(cursor)}
              >
                {tBulk("more")}
              </button>
            )}
          </>
        )}
        {formScope &&
          personalRecoveryAllowed &&
          editor &&
          !recovery.privacyHold && (
            <MealPrepEditor
              context={formScope}
              restoredDraft={editor.restoredDraft}
              defaultDay={editor.day}
              seed={editor.seed}
              initialRecipe={editor.recipe}
              freshWritesBlocked={mutationsBlocked}
              onClose={() => setEditor(null)}
              onSaved={saved}
              onReload={() => load()}
            />
          )}
        {scope &&
          personalRecoveryAllowed &&
          modal &&
          modalSession &&
          !recovery.privacyHold && (
            <MealPrepActionSheet
              kind={modal.kind}
              restoredDraft={modal.restoredDraft}
              requirePrepared={
                preparedReuse.state === "target" &&
                modal.kind === "allocate" &&
                modal.sessionId === preparedReuse.target.sessionId &&
                modal.batchId === preparedReuse.target.batchId
              }
              context={scope}
              session={modalSession}
              batch={modalSession.batches.find(
                (row) => row.id === modal.batchId,
              )}
              consumptionId={modal.consumptionId}
              freshWritesBlocked={mutationsBlocked}
              onClose={() => {
                setModal(null);
                if (reuseRef.current.state !== "none")
                  onDismissPreparedReuse?.();
              }}
              onSaved={() => saved()}
              onReload={() => load()}
            />
          )}
      </section>
    </BulkRecoveryProvider>
  );
}
