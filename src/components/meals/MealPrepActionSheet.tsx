"use client";
import * as React from "react";
import { useBulkFormDraft } from "./recovery/BulkRecoveryContext";
import { navigateAfterOwnedDrafts } from "@/lib/owned-draft-exit";
import type { PrepDraft } from "@/lib/meal-prep-recovery/draft-contract";
import { Dialog } from "@/components/ui/dialog";
import { useBulkCookingText } from "@/i18n/bulk-cooking";
import {
  batchPortionCounts,
  mealPrepActionSchema,
  type MealBatchSummary,
  type MealPrepSummary,
  type MealPrepContext,
} from "@/lib/meal-batches";
import { toDateOnlyUTC } from "@/lib/dates";
import { useMealPrepMutation } from "./use-meal-prep-mutation";
import {
  MealAllocationEditor,
  type AllocationDraft,
} from "./MealAllocationEditor";

export type PrepActionKind =
  "allocate" | "eaten" | "prepared" | "next-prep" | "undo-eaten";
export function MealPrepActionSheet({
  kind,
  session,
  batch,
  consumptionId,
  context,
  freshWritesBlocked = false,
  requirePrepared = false,
  restoredDraft,
  onClose,
  onSaved,
  onReload,
}: {
  kind: PrepActionKind;
  session: MealPrepSummary;
  batch?: MealBatchSummary;
  consumptionId?: string;
  context: MealPrepContext;
  freshWritesBlocked?: boolean;
  requirePrepared?: boolean;
  restoredDraft?: Extract<PrepDraft, { kind: "action" }>;
  onClose: () => void;
  onSaved: () => void;
  onReload: () => Promise<MealPrepSummary[] | null>;
}) {
  const tBulk = useBulkCookingText();
  const origin = React.useRef(context);
  const requirePreparedOrigin = React.useRef(
    restoredDraft?.requirePrepared ?? requirePrepared,
  );
  const prefix = React.useId();
  const counts = batch
    ? batchPortionCounts(batch.total_servings, batch.meals, batch.consumption)
    : null;
  const remainingFor = (id: string) => {
    if (!batch) return 0;
    const meal = batch.meals.find((row) => row.id === id);
    return meal
      ? meal.servings -
          batch.consumption
            .filter((row) => row.meal_id === id)
            .reduce((n, row) => n + row.servings, 0)
      : 0;
  };
  const [mealId, setMealId] = React.useState(
    () =>
      restoredDraft?.mealId ??
      (counts && counts.unplanned > 0
        ? ""
        : (batch?.meals.find((row) => remainingFor(row.id) > 0)?.id ?? "")),
  );
  const initialMealId = React.useRef(mealId);
  const [servings, setServings] = React.useState(
    restoredDraft?.servings ?? "1",
  );
  const [meals, setMeals] = React.useState<AllocationDraft[]>(
    restoredDraft?.meals ?? [],
  );
  const [nextDay, setNextDay] = React.useState(
    restoredDraft?.nextDay ??
      (session.next_prep_on ? toDateOnlyUTC(session.next_prep_on) : ""),
  );
  const expectedNext = React.useRef(
    restoredDraft
      ? restoredDraft.expectedNext
      : session.next_prep_on
        ? toDateOnlyUTC(session.next_prep_on)
        : null,
  );
  const [invalid, setInvalid] = React.useState(false);
  const [discard, setDiscard] = React.useState(false);
  const [reloading, setReloading] = React.useState(false);
  useBulkFormDraft({
    kind: "action",
    action: kind,
    sessionId: session.id,
    ...(batch ? { batchId: batch.id } : {}),
    ...(consumptionId ? { consumptionId } : {}),
    requirePrepared: requirePreparedOrigin.current,
    mealId,
    servings,
    meals,
    nextDay,
    expectedNext: expectedNext.current,
  });
  const mutation = useMealPrepMutation(onSaved, { freshWritesBlocked });
  const dirty =
    kind === "allocate"
      ? meals.length > 0
      : kind === "eaten"
        ? servings !== "1" || mealId !== initialMealId.current
        : kind === "next-prep"
          ? nextDay !== (expectedNext.current ?? "")
          : false;
  React.useEffect(() => {
    if (!dirty || mutation.owned) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, mutation.owned]);
  const close = () => {
    if (mutation.owned) {
      if (!mutation.closeBlocked) void navigateAfterOwnedDrafts(onClose);
      return;
    }
    if (mutation.isPending()) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  const title =
    kind === "allocate"
      ? tBulk("schedule")
      : kind === "eaten"
        ? tBulk("recordEaten")
        : kind === "prepared"
          ? tBulk("markPrepared")
          : kind === "next-prep"
            ? tBulk("changeNext")
            : tBulk("undoEaten");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending() || freshWritesBlocked) return;
    const scope = {
      expected_family_id: origin.current.familyId,
      expected_user_id: origin.current.userId,
    };
    const body =
      kind === "allocate"
        ? {
            ...scope,
            action: kind,
            ...(requirePreparedOrigin.current
              ? { require_prepared: true }
              : {}),
            batch_id: batch?.id,
            meals: meals.map((row) => ({
              ...row,
              servings: Number(row.servings),
            })),
          }
        : kind === "eaten"
          ? {
              ...scope,
              action: kind,
              batch_id: batch?.id,
              meal_id: mealId || null,
              servings: Number(servings),
            }
          : kind === "next-prep"
            ? {
                ...scope,
                action: kind,
                session_id: session.id,
                next_prep_on: nextDay || null,
                expected_next_prep_on: expectedNext.current,
              }
            : kind === "prepared"
              ? { ...scope, action: kind, session_id: session.id }
              : { ...scope, action: kind, consumption_id: consumptionId };
    const parsed = mealPrepActionSchema.safeParse(body);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void mutation.save(parsed.data);
  };
  const reload = async () => {
    setReloading(true);
    try {
      const latest = await onReload();
      const current = latest?.find((row) => row.id === session.id);
      if (current) {
        expectedNext.current = current.next_prep_on
          ? toDateOnlyUTC(current.next_prep_on)
          : null;
        if (kind === "next-prep") setNextDay(expectedNext.current ?? "");
        if (kind === "eaten" && batch) {
          const refreshed = current.batches.find((row) => row.id === batch.id);
          if (refreshed) {
            const available = batchPortionCounts(
              refreshed.total_servings,
              refreshed.meals,
              refreshed.consumption,
            );
            const outstanding = (id: string) => {
              const row = refreshed.meals.find((meal) => meal.id === id);
              return row
                ? row.servings -
                    refreshed.consumption
                      .filter((entry) => entry.meal_id === id)
                      .reduce((sum, entry) => sum + entry.servings, 0)
                : 0;
            };
            const choice =
              mealId && outstanding(mealId) > 0
                ? mealId
                : available.unplanned > 0
                  ? ""
                  : (refreshed.meals.find((row) => outstanding(row.id) > 0)
                      ?.id ?? "");
            const max = choice ? outstanding(choice) : available.unplanned;
            setMealId(choice);
            setServings(
              String(Math.max(1, Math.min(Number(servings) || 1, max))),
            );
          }
        }
        mutation.clearError();
      }
    } finally {
      setReloading(false);
    }
  };
  return (
    <>
      <Dialog
        open
        variant="form"
        title={title}
        description={batch?.name}
        onClose={mutation.closeBlocked ? undefined : close}
        closeLabel={tBulk("close")}
        className="sm:max-w-xl"
        testId="meal-prep-action"
      >
        <form onSubmit={submit} className="space-y-4">
          {counts && (
            <p className="text-subhead text-label-secondary" role="status">
              {tBulk("remaining", { count: counts.remaining })} ·{" "}
              {tBulk("planned", { count: counts.planned })} ·{" "}
              {tBulk("unplanned", { count: counts.unplanned })}
            </p>
          )}
          {kind === "allocate" && counts && (
            <MealAllocationEditor
              meals={meals}
              preparationDay={toDateOnlyUTC(session.prepared_on)}
              available={counts.unplanned}
              disabled={mutation.locked}
              onChange={setMeals}
            />
          )}
          {kind === "eaten" && batch && counts && (
            <>
              <label className="block text-subhead" htmlFor={`${prefix}-meal`}>
                {tBulk("eatenFrom")}
                <select
                  id={`${prefix}-meal`}
                  className="input-field w-full mt-1"
                  value={mealId}
                  disabled={mutation.locked}
                  onChange={(e) => setMealId(e.target.value)}
                >
                  <option value="" disabled={counts.unplanned <= 0}>
                    {tBulk("unplannedChoice")} · {counts.unplanned}
                  </option>
                  {batch.meals
                    .filter((row) => remainingFor(row.id) > 0)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {toDateOnlyUTC(row.date)} · {tBulk(row.meal_type)} ·{" "}
                        {remainingFor(row.id)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-subhead" htmlFor={`${prefix}-eaten`}>
                {tBulk("eatenCount")}
                <input
                  id={`${prefix}-eaten`}
                  className="input-field w-full mt-1"
                  type="number"
                  min={1}
                  max={mealId ? remainingFor(mealId) : counts.unplanned}
                  step={1}
                  required
                  value={servings}
                  disabled={mutation.locked}
                  onChange={(e) => setServings(e.target.value)}
                />
              </label>
            </>
          )}
          {kind === "next-prep" && (
            <label className="block text-subhead" htmlFor={`${prefix}-next`}>
              {tBulk("nextDate")}
              <input
                id={`${prefix}-next`}
                className="input-field w-full mt-1"
                type="date"
                min={toDateOnlyUTC(session.prepared_on)}
                value={nextDay}
                disabled={mutation.locked}
                onChange={(e) => setNextDay(e.target.value)}
              />
            </label>
          )}
          {kind === "prepared" && (
            <p className="text-subhead text-label-secondary">
              {tBulk("prepSummary", {
                date: toDateOnlyUTC(session.prepared_on),
              })}
            </p>
          )}
          {kind === "undo-eaten" && batch && (
            <p className="text-subhead text-label-secondary">
              {tBulk("eaten", {
                count:
                  batch.consumption.find((row) => row.id === consumptionId)
                    ?.servings ?? 0,
              })}
            </p>
          )}
          {mutation.completed && <p role="status">{tBulk("saveConfirmed")}</p>}
          {(invalid || mutation.error) && (
            <p role="alert" className="text-subhead text-[var(--danger-text)]">
              {mutation.error ?? tBulk("invalid")}
            </p>
          )}
          {freshWritesBlocked && (
            <div role="status" className="space-y-2">
              <p className="text-subhead text-label-secondary">
                {tBulk("reloadBeforeSave")}
              </p>
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={reloading}
                onClick={() => void reload()}
              >
                {reloading ? tBulk("loading") : tBulk("reload")}
              </button>
            </div>
          )}
          {mutation.unknown && (
            <p className="text-footnote text-label-secondary">
              {tBulk("unknown")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {mutation.unknown ? (
              <button
                type="button"
                className="btn-filled min-h-[44px]"
                disabled={mutation.retryBlocked}
                onClick={() => void mutation.retry()}
              >
                {mutation.busy ? tBulk("saving") : tBulk("retry")}
              </button>
            ) : (
              <button
                type="submit"
                className="btn-filled min-h-[44px]"
                disabled={
                  mutation.locked ||
                  reloading ||
                  freshWritesBlocked ||
                  (kind === "allocate" && meals.length === 0)
                }
              >
                {mutation.busy
                  ? tBulk("saving")
                  : kind === "allocate"
                    ? tBulk("saveMeals")
                    : kind === "eaten"
                      ? tBulk("saveEaten")
                      : title}
              </button>
            )}
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              disabled={mutation.closeBlocked}
              onClick={close}
            >
              {mutation.owned ? tBulk("close") : tBulk("cancel")}
            </button>
            {mutation.error && !mutation.unknown && !freshWritesBlocked && (
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={reloading}
                onClick={() => void reload()}
              >
                {tBulk("reload")}
              </button>
            )}
          </div>
        </form>
      </Dialog>
      <Dialog
        open={discard}
        role="alertdialog"
        title={tBulk("discardTitle")}
        description={tBulk("discardBody")}
        onClose={() => setDiscard(false)}
        closeLabel={tBulk("keep")}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            onClick={() => setDiscard(false)}
          >
            {tBulk("keep")}
          </button>
          <button
            type="button"
            className="btn-filled min-h-[44px]"
            onClick={onClose}
          >
            {tBulk("discard")}
          </button>
        </div>
      </Dialog>
    </>
  );
}
