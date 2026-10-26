"use client";
import * as React from "react";
import Link from "next/link";
import { preparedReuseHref } from "@/lib/prepared-meal-reuse";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { useFoodPlanningSheetText } from "@/i18n/food-planning-sheet";
import { useOwnedDraftExit } from "@/components/layout/owned-draft-navigation";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { navigateAfterOwnedDrafts } from "@/lib/owned-draft-exit";
import {
  newFoodSlot,
  type FoodEditorDraft,
  type FoodEditorSlot,
} from "@/lib/food-planning/editor";
import { addDaysToKey } from "@/lib/local-day-key";
import {
  scheduleWallChoices,
  formatScheduleInstant,
} from "@/lib/calendar-planning/schedule-form";
import { FoodAiProposal } from "./FoodAiProposal";
import { FoodPlanSummary } from "./FoodPlanSummary";
import { FoodSaveDetails } from "./FoodSaveDetails";
import { FoodRecordPicker } from "./FoodRecordPicker";
import { FoodGroceryOutcomesView } from "./FoodGroceryOutcomes";
import { FoodGroceryChoices } from "./FoodGroceryChoices";
import { FoodAllocationEditor } from "./FoodAllocationEditor";
import { resolveScheduleWall } from "@/lib/calendar-planning/schedule-form";
import type { FoodRecoveryContext } from "@/lib/food-planning/recovery-contract";
import { useFoodPlanningSession } from "./useFoodPlanningSession";
const input =
  "mt-1 min-h-11 w-full rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-fill-secondary)] px-3 py-2 text-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] disabled:opacity-50";
export default function FoodPlanningSheet({
  day,
  mode,
  onClose,
  onSaved,
}: {
  day: string;
  mode: "meals" | "prep";
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useDraftAwareRouter();
  const text = useFoodPlanningSheetText();
  const session = useFoodPlanningSession(onSaved),
    latest = React.useRef(session);
  latest.current = session;
  const [position, setPosition] = React.useState(0),
    [forget, setForget] = React.useState<string | null>(null),
    [acknowledged, setAcknowledged] = React.useState(false),
    [reload, setReload] = React.useState(false);
  React.useEffect(() => {
    void latest.current.load();
  }, []);
  async function close() {
    await navigateAfterOwnedDrafts(onClose);
  }
  const navigation = usePendingFormNavigationController(true, {
    onBack: () => {
      if (forget !== null || reload) {
        setForget(null);
        setReload(false);
        return;
      }
      void close();
    },
    warnOnUnload: session.busy || session.dirty || session.issue === "storage",
  });
  useOwnedDraftExit(
    true,
    () => latest.current.prepareLeave(),
    () => navigation.releaseBeforeNavigation(),
  );
  const draft = session.draft,
    index = draft ? Math.min(position, draft.slots.length - 1) : 0,
    slot = draft?.slots[index];
  const disabled =
    session.busy ||
    !session.context?.enabled ||
    session.issue === "storage" ||
    session.issue === "owner";
  const view = session.review ?? session.preview;
  function update(patch: Partial<FoodEditorDraft>) {
    if (draft) session.change({ ...draft, ...patch });
  }
  function updateSlot(patch: Partial<FoodEditorSlot>) {
    if (draft && slot)
      update({
        slots: draft.slots.map((row) =>
          row.key === slot.key ? { ...row, ...patch } : row,
        ),
      });
  }
  const messages = {
    ai: text("aiReadFailed"),
    catalog: text("recipePoolRequired"),
    load: text("loadFailed"),
    owner: text("ownerChanged"),
    storage: text("storageRepairRequired"),
    invalid: text("invalidDraft"),
    unknown: text("unknownSave"),
    held: text("heldWork"),
  };
  return (
    <>
      <Dialog
        open
        variant="form"
        title={text("planMealsAndPrep")}
        closeLabel={text("closePlanner")}
        onClose={() => {
          void close();
        }}
        footer={
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              onClick={() => {
                void close();
              }}
            >
              {text("close")}
            </button>
            {draft && !view && (
              <button
                type="button"
                className="btn-filled min-h-[44px]"
                disabled={disabled}
                onClick={() => void session.previewDraft()}
              >
                {text("findSuggestions")}
              </button>
            )}
            {draft && view && (
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                disabled={disabled}
                onClick={() => session.change(draft)}
              >
                {text("editChoices")}
              </button>
            )}
            {draft && session.preview && (
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                disabled={
                  disabled ||
                  (draft.mode === "prep" && !session.context?.canPrep) ||
                  session.preview.plan.slots.some(
                    (row) => row.holds.length || !row.choice,
                  )
                }
                onClick={() => void session.reviewDraft()}
              >
                {session.review
                  ? text("refreshReview")
                  : text("reviewSave")}
              </button>
            )}
            {session.review && (
              <button
                type="button"
                className="btn-filled min-h-[44px]"
                disabled={
                  disabled ||
                  (session.review.input.mode === "prep" &&
                    !session.context?.canPrep)
                }
                onClick={() => void session.confirm()}
              >
                {text("confirmAndSave")}
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4" aria-busy={session.busy}>
          {session.busy && (
            <p role="status">{text("working")}</p>
          )}
          {session.issue && (
            <div role="alert" className="space-y-2">
              <p>{messages[session.issue]}</p>
              {session.issue === "storage" ? (
                <button
                  type="button"
                  disabled={session.busy}
                  className="btn-secondary min-h-[44px]"
                  onClick={() => void session.repair()}
                >
                  {text("repairSavedTransition")}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={session.busy}
                  className="btn-secondary min-h-[44px]"
                  onClick={() => setReload(true)}
                >
                  {text("reloadSavedWork")}
                </button>
              )}
            </div>
          )}
          {session.context && !session.context.enabled && (
            <p role="status">
              {text("planningPaused")}
            </p>
          )}
          {!draft && session.context?.enabled && (
            <button
              type="button"
              disabled={session.busy}
              className="btn-filled min-h-[44px]"
              onClick={() => void session.start(day, mode)}
            >
              {text("startAPlan")}
            </button>
          )}
          {draft?.mode === "prep" &&
            session.context &&
            !session.context.canPrep && (
              <p role="status">
                {text("prepVerificationRequired")}
              </p>
            )}
          {draft && !view && slot && (
            <fieldset disabled={disabled} className="space-y-4 min-w-0">
              <legend className="font-semibold">
                {text("whatAreYouPlanning")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {(["meals", "prep"] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={draft.mode === choice}
                    className="btn-secondary min-h-[44px]"
                    onClick={() => update({ mode: choice })}
                  >
                    {choice === "meals"
                      ? text("severalMeals")
                      : text("onePrepSession")}
                  </button>
                ))}
              </div>
              {session.context && (
                <details>
                  <summary className="min-h-[44px] py-3 cursor-pointer">
                    {text("recipePoolOptional")}
                  </summary>
                  <p className="text-footnote">
                    {text("recipePoolHint")}
                  </p>
                  <FoodRecordPicker
                    kind="recipes"
                    multiple
                    label={text("suggestFromTheseRecipes")}
                    emptyLabel={text("useTheHouseholdLibrary")}
                    values={draft.recipeIds}
                    context={session.context}
                    disabled={disabled}
                    onFailure={session.reportError}
                    onChange={(recipeIds) => update({ recipeIds })}
                  />
                </details>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  {text("prioritize")}
                  <select
                    className={input}
                    value={draft.priority}
                    onChange={(event) =>
                      update({
                        priority: event.target
                          .value as FoodEditorDraft["priority"],
                      })
                    }
                  >
                    <option value="use-soon">
                      {text("useFoodSoon")}
                    </option>
                    <option value="least-shopping">
                      {text("lessShopping")}
                    </option>
                    <option value="quick">
                      {text("shorterRecipeTime")}
                    </option>
                  </select>
                </label>
                <label className="flex min-h-[44px] items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.repeatRecipes}
                    onChange={(event) =>
                      update({ repeatRecipes: event.target.checked })
                    }
                  />
                  {text("allowRepeatedSuggestions")}
                </label>
                {draft.mode === "prep" && (
                  <>
                    <label>
                      {text("prepDay")}
                      <input
                        className={input}
                        type="date"
                        value={draft.prepDay}
                        onChange={(event) =>
                          update({ prepDay: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      {text("nextPrepOptional")}
                      <input
                        className={input}
                        type="date"
                        value={draft.nextPrepDay}
                        onChange={(event) =>
                          update({ nextPrepDay: event.target.value })
                        }
                      />
                    </label>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={index === 0}
                  onClick={() => setPosition(index - 1)}
                >
                  {text("previous")}
                </button>
                <span>
                  {index + 1} / {draft.slots.length}
                </span>
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={index + 1 === draft.slots.length}
                  onClick={() => setPosition(index + 1)}
                >
                  {text("next")}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {draft.mode === "meals" && (
                  <>
                    <label>
                      {text("day")}
                      <input
                        className={input}
                        type="date"
                        value={slot.date}
                        onChange={(event) =>
                          updateSlot({ date: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      {text("meal")}
                      <select
                        className={input}
                        value={slot.mealType}
                        onChange={(event) =>
                          updateSlot({
                            mealType: event.target
                              .value as FoodEditorSlot["mealType"],
                          })
                        }
                      >
                        <option value="breakfast">
                          {text("breakfast")}
                        </option>
                        <option value="lunch">
                          {text("lunch")}
                        </option>
                        <option value="dinner">{text("dinner")}</option>
                        <option value="snack">
                          {text("snack")}
                        </option>
                      </select>
                    </label>
                  </>
                )}
                <label>
                  {draft.mode === "prep"
                    ? text("totalDishPortions")
                    : text("servings")}
                  <input
                    className={input}
                    type="number"
                    min="1"
                    max={draft.mode === "prep" ? 50 : 100}
                    step="1"
                    value={slot.servings}
                    onChange={(event) =>
                      updateSlot({ servings: event.target.value })
                    }
                  />
                </label>
                <label>
                  {text("recipeTimeLimitOptionalMinutes")}
                  <input
                    className={input}
                    type="number"
                    min="1"
                    max="1440"
                    value={slot.maxMinutes}
                    onChange={(event) =>
                      updateSlot({ maxMinutes: event.target.value })
                    }
                  />
                </label>
                {draft.mode === "prep" && (
                  <>
                    <label>
                      {text("dishLabelOptional")}
                      <input
                        className={input}
                        value={slot.name}
                        maxLength={200}
                        onChange={(event) =>
                          updateSlot({ name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      {text("storeRemainingPortions")}
                      <select
                        className={input}
                        value={slot.storage}
                        onChange={(event) =>
                          updateSlot({
                            storage: event.target.value as "fridge" | "freezer",
                          })
                        }
                      >
                        <option value="fridge">
                          {text("fridge")}
                        </option>
                        <option value="freezer">
                          {text("freezer")}
                        </option>
                      </select>
                    </label>
                  </>
                )}
              </div>
              {session.context && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FoodRecordPicker
                    key={`recipe-${slot.key}`}
                    kind="recipes"
                    label={text("recipe")}
                    emptyLabel={text("suggestAutomatically")}
                    values={slot.recipeId ? [slot.recipeId] : []}
                    context={session.context}
                    disabled={disabled}
                    onFailure={session.reportError}
                    onChange={(ids) =>
                      update({
                        slots: draft.slots.map((row) =>
                          row.key === slot.key
                            ? { ...row, recipeId: ids[0] ?? "" }
                            : row,
                        ),
                        groceries: draft.groceries.filter(
                          (row) => row.key !== slot.key,
                        ),
                      })
                    }
                  />
                  <FoodRecordPicker
                    key={`cook-${slot.key}`}
                    kind="people"
                    label={text("cookOptionalAccount")}
                    emptyLabel={text("noCookAssigned")}
                    values={slot.cookId ? [slot.cookId] : []}
                    context={session.context}
                    disabled={disabled}
                    onFailure={session.reportError}
                    onChange={(ids) => updateSlot({ cookId: ids[0] ?? "" })}
                  />
                </div>
              )}
              {slot.recipeId &&
                draft.recipeIds.length > 0 &&
                !draft.recipeIds.includes(slot.recipeId) && (
                  <p role="status">
                    {text("recipeOutsidePool")}
                  </p>
                )}
              {draft.mode === "meals" && (
                <details>
                  <summary className="min-h-[44px] py-3 cursor-pointer">
                    {text("notesAndCookingWindow")}
                  </summary>
                  <label>
                    {text("notesOptional")}
                    <textarea
                      className={input}
                      maxLength={2000}
                      value={slot.notes}
                      onChange={(event) =>
                        updateSlot({ notes: event.target.value })
                      }
                    />
                  </label>
                  <Timing
                    value={slot.timing}
                    zone={draft.timeZone}
                    context={session.context}
                    onFailure={session.reportError}
                    disabled={disabled}
                    onChange={(timing) => updateSlot({ timing })}
                  />
                </details>
              )}
              {draft.mode === "prep" && session.context && (
                <FoodAllocationEditor
                  key={slot.key}
                  slot={slot}
                  prepDay={draft.prepDay}
                  context={session.context}
                  disabled={disabled}
                  onFailure={session.reportError}
                  onChange={(allocations) => updateSlot({ allocations })}
                />
              )}
              {draft.mode === "prep" && (
                <details>
                  <summary className="min-h-[44px] py-3 cursor-pointer">
                    {text("sessionTiming")}
                  </summary>
                  <label>
                    {text("totalSessionLimitOptionalMinutes")}
                    <input
                      className={input}
                      type="number"
                      min="1"
                      max="1440"
                      value={draft.prepMaxMinutes}
                      onChange={(event) =>
                        update({ prepMaxMinutes: event.target.value })
                      }
                    />
                  </label>
                  <Timing
                    value={draft.prepTiming}
                    zone={draft.timeZone}
                    context={session.context}
                    onFailure={session.reportError}
                    disabled={disabled}
                    onChange={(prepTiming) => update({ prepTiming })}
                  />
                </details>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={
                    draft.slots.length >= (draft.mode === "prep" ? 8 : 14)
                  }
                  onClick={() => {
                    const date =
                      draft.mode === "prep"
                        ? draft.prepDay
                        : addDaysToKey(
                            draft.slots[draft.slots.length - 1].date || day,
                            1,
                          );
                    update({ slots: [...draft.slots, newFoodSlot(date)] });
                    setPosition(draft.slots.length);
                  }}
                >
                  {draft.mode === "prep"
                    ? text("addDish")
                    : text("addMeal")}
                </button>
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={draft.slots.length === 1}
                  onClick={() =>
                    update({
                      slots: draft.slots.filter((row) => row.key !== slot.key),
                      groceries: draft.groceries.filter(
                        (row) => row.key !== slot.key,
                      ),
                    })
                  }
                >
                  {text("removeThisChoice")}
                </button>
              </div>
              <p className="text-footnote text-label-secondary">
                {text("previewBoundary")}
              </p>
            </fieldset>
          )}
          {draft && session.context?.canAskAi && !session.review && (
            <details className="rounded-xl border border-[var(--surface-separator)] p-3">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                {text("askAiForMealChoices")}
              </summary>
              <div className="space-y-3">
                <p className="text-footnote text-label-secondary">
                  {text("aiDisclosure")}
                </p>
                <label className="block">
                  {text("cookingPreferenceOptional")}
                  <textarea
                    className={input}
                    maxLength={1000}
                    rows={2}
                    disabled={disabled}
                    value={draft.aiPreference}
                    onChange={(event) =>
                      update({ aiPreference: event.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={disabled}
                  onClick={() => void session.askAi()}
                >
                  {text("askAi")}
                </button>
              </div>
            </details>
          )}
          {draft && session.aiSuggestion && (
            <FoodAiProposal
              suggestion={session.aiSuggestion}
              busy={disabled}
              onUse={() => void session.acceptAi()}
              onDismiss={session.dismissAi}
            />
          )}
          {view && draft && (
            <FoodPlanSummary
              plan={view.plan}
              timeZone={draft.timeZone}
              mode={draft.mode}
              busy={session.busy}
              onOpenCommitment={(target) => {
                if (!session.busy)
                  void router.push(
                    target.kind === "meal"
                      ? `/dashboard/meals?start=${encodeURIComponent(target.date)}`
                      : "/dashboard/meals?view=bulk",
                  );
              }}
              onReusePrepared={
                session.context?.canPrep
                  ? (target) => {
                      if (!session.busy)
                        void router.push(preparedReuseHref(target));
                    }
                  : undefined
              }
              detailsForChoice={
                session.review
                  ? (key) => (
                      <FoodSaveDetails
                        review={session.review!}
                        choiceKey={key}
                      />
                    )
                  : session.context
                    ? (key) => {
                        const choice = session.preview?.plan.slots.find(
                          (row) => row.key === key,
                        )?.choice;
                        return choice ? (
                          <FoodGroceryChoices
                            key={key}
                            choice={choice}
                            selection={
                              draft.groceries.find(
                                (row) => row.key === key,
                              ) ?? { key, listId: "", ingredientIds: [] }
                            }
                            context={session.context!}
                            disabled={disabled}
                            onFailure={session.reportError}
                            onChange={(selection) =>
                              session.change(
                                {
                                  ...draft,
                                  groceries: [
                                    ...draft.groceries.filter(
                                      (row) => row.key !== key,
                                    ),
                                    selection,
                                  ],
                                },
                                true,
                              )
                            }
                          />
                        ) : null;
                      }
                    : undefined
              }
              onChooseRecipe={(key, recipeId) => {
                session.change({
                  ...draft,
                  slots: draft.slots.map((row) =>
                    row.key === key ? { ...row, recipeId } : row,
                  ),
                  groceries: draft.groceries.filter((row) => row.key !== key),
                });
                void session.previewDraft();
              }}
            />
          )}
          {session.review && (
            <section className="space-y-2">
              <h3 className="font-semibold">
                {text("confirmTheExactSave")}
              </h3>
              <p>
                {session.review.input.mode === "meals"
                  ? `${session.review.input.meals.length} ${text("newMeals")}`
                  : `${session.review.input.input.dishes.length} ${text("dishesInOneUnpreparedSession")}`}
              </p>
              <p>
                {session.review.groceries.length
                  ? text("fullRecipeGroceryQuantities")
                  : text("noGroceryAdds")}
              </p>
              <p className="text-footnote">
                {text("reviewExpiry")}
              </p>
            </section>
          )}
          {session.rows.filter((entry) => entry.kind === "food-plan").length >
            0 && (
            <section className="space-y-3">
              <h3 className="font-semibold">
                {text("savedRequests")}
              </h3>
              {session.rows
                .filter((entry) => entry.kind === "food-plan")
                .map((entry, i) => {
                  const proof = session.inspections[entry.key];
                  const savedReceipt =
                    session.confirmed[entry.key] ?? proof?.receipt;
                  const hasGroceries = !!savedReceipt?.groceries.length;
                  const uncertainUndo = Object.values(
                    session.groceryUndos[entry.key] ?? {},
                  ).some((value) => value === "unknown");
                  const committed =
                    proof?.state === "committed" ||
                    !!session.confirmed[entry.key];
                  return (
                    <article
                      key={entry.key}
                      className="card-apple p-3 space-y-2"
                    >
                      <p className="font-semibold">
                        {text("foodRequest")} {i + 1}
                      </p>
                      <p>
                        {committed
                          ? text("saveConfirmed")
                          : text("outcomeUnconfirmed")}
                      </p>
                      {committed && hasGroceries && (
                        <FoodGroceryOutcomesView
                          outcome={session.groceryOutcomes[entry.key]}
                          undos={session.groceryUndos[entry.key]}
                          readError={session.groceryReadErrors[entry.key]}
                          busy={session.busy}
                          onRead={() => void session.readGroceries(entry.key)}
                          onUndo={(requestId) =>
                            void session.undoGroceries(entry.key, requestId)
                          }
                        />
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-secondary min-h-[44px]"
                          disabled={session.busy}
                          onClick={() => void session.inspect(entry.key)}
                        >
                          {text("inspectReceipt")}
                        </button>
                        {proof?.retryEligible && (
                          <button
                            type="button"
                            className="btn-filled min-h-[44px]"
                            disabled={session.busy}
                            onClick={() => void session.retry(entry.key)}
                          >
                            {text("retryExactRequest")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-secondary min-h-[44px]"
                          disabled={session.busy}
                          onClick={() => {
                            if (committed && !uncertainUndo) {
                              void session.dismiss(entry.key);
                              return;
                            }
                            setAcknowledged(false);
                            setForget(entry.key);
                          }}
                        >
                          {committed
                            ? text("dismissSavedReceipt")
                            : text("forgetLocalRequest")}
                        </button>
                      </div>
                    </article>
                  );
                })}
            </section>
          )}
          {session.rows.some((entry) => entry.kind === "local-food-draft") && (
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              disabled={session.busy}
              onClick={() => {
                setAcknowledged(false);
                setForget(
                  session.rows.find(
                    (entry) => entry.kind === "local-food-draft",
                  )!.key,
                );
              }}
            >
              {text("discardEditableDraft")}
            </button>
          )}
          <Link
            href="/dashboard/meals?view=bulk"
            className="inline-flex min-h-[44px] items-center text-[var(--accent-text)]"
            aria-disabled={session.busy || undefined}
            tabIndex={session.busy ? -1 : undefined}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              if (!session.busy) void router.push("/dashboard/meals?view=bulk");
            }}
          >
            {text("managePreparedMeals")}
          </Link>
        </div>
      </Dialog>
      <Dialog
        open={forget !== null || reload}
        role="alertdialog"
        title={
          reload
            ? text("reloadStoredWork")
            : text("removeLocalWork")
        }
        closeLabel={text("keepWorking")}
        onClose={() => {
          setForget(null);
          setReload(false);
        }}
      >
        <p>
          {reload
            ? text("reloadWarning")
            : text("removeWarning")}
        </p>
        <label className="flex min-h-[44px] items-center gap-2">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          {text("iUnderstand")}
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary min-h-[44px]"
            onClick={() => {
              setForget(null);
              setReload(false);
            }}
          >
            {text("keepWorking")}
          </button>
          <button
            type="button"
            className="btn-filled min-h-[44px]"
            disabled={!acknowledged || session.busy}
            onClick={() => {
              if (reload) {
                setReload(false);
                void session.load();
              } else if (forget) {
                const key = forget;
                setForget(null);
                void session.dismiss(key);
              }
            }}
          >
            {reload
              ? text("reloadSavedCopy")
              : text("removeLocally")}
          </button>
        </div>
      </Dialog>
    </>
  );
}
function Timing({
  value,
  zone,
  context,
  onFailure,
  disabled,
  onChange,
}: {
  value: FoodEditorSlot["timing"];
  zone: string;
  context: FoodRecoveryContext | null;
  onFailure: (error: unknown) => void;
  disabled: boolean;
  onChange: (next: FoodEditorSlot["timing"]) => void;
}) {
  const { locale } = useTranslation();
  const text = useFoodPlanningSheetText();
  let departureRange: { start: string; end: string } | undefined;
  try {
    const start = resolveScheduleWall(value.start, value.startChoice, zone),
      end = resolveScheduleWall(value.end, value.endChoice, zone);
    if (Date.parse(end) > Date.parse(start))
      departureRange = {
        start,
        end: new Date(Date.parse(end) + 86400000).toISOString(),
      };
  } catch {
    /* Preserve unfinished/fold choices, never guess a departure interval. */
  }
  return (
    <div className="space-y-3">
      <label className="flex min-h-[44px] items-center gap-2">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) =>
            onChange({ ...value, enabled: event.target.checked })
          }
        />
        {text("checkACookingWindow")}
      </label>
      {value.enabled && (
        <>
          <p className="text-footnote">{zone}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["start", "end"] as const).map((key) => {
              const choices = scheduleWallChoices(value[key], zone),
                selected = key === "start" ? "startChoice" : "endChoice";
              return (
                <label key={key}>
                  {key === "start" ? text("start") : text("end")}
                  <input
                    type="datetime-local"
                    className={input}
                    value={value[key]}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [key]: event.target.value,
                        [selected]: null,
                      })
                    }
                  />
                  {choices.length > 1 && (
                    <select
                      aria-label={text("chooseTimeOffset")}
                      className={input}
                      value={value[selected] ?? ""}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          [selected]: event.target.value || null,
                        })
                      }
                    >
                      <option value="">
                        {text("chooseAnExactTime")}
                      </option>
                      {choices.map((choice) => (
                        <option key={choice} value={choice}>
                          {formatScheduleInstant(choice, locale, zone)}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              );
            })}
          </div>
          {context && departureRange ? (
            <FoodRecordPicker
              kind="departures"
              label={text("departureDeadlineOptional")}
              emptyLabel={text("noDepartureSelected")}
              values={value.departureId ? [value.departureId] : []}
              context={context}
              range={departureRange}
              zone={zone}
              disabled={disabled}
              onFailure={onFailure}
              onChange={(ids) =>
                onChange({
                  ...value,
                  departureId: ids[0] ?? "",
                  ...(!ids.length
                    ? { travel: "0", departurePreparation: "0" }
                    : {}),
                })
              }
            />
          ) : (
            <p className="text-footnote">
              {text("departureWindowRequired")}
            </p>
          )}
          {!departureRange && value.departureId && (
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...value,
                  departureId: "",
                  travel: "0",
                  departurePreparation: "0",
                })
              }
            >
              {text("clearDepartureAndBuffers")}
            </button>
          )}
          {(value.departureId ||
            value.travel !== "0" ||
            value.departurePreparation !== "0") && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(["travel", "departurePreparation"] as const).map((key) => (
                <label key={key}>
                  {key === "travel"
                    ? text("travelMin")
                    : text("gettingReadyToLeaveMin")}
                  <input
                    type="number"
                    className={input}
                    min="0"
                    max="240"
                    value={value[key]}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange({ ...value, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {(["before", "eating", "cleanup"] as const).map((key) => (
              <label key={key}>
                {key === "before"
                  ? text("extraSetupMin")
                  : key === "eating"
                    ? text("eatingMin")
                    : text("cleanupMin")}
                <input
                  type="number"
                  className={input}
                  min="0"
                  max="240"
                  value={value[key]}
                  onChange={(event) =>
                    onChange({ ...value, [key]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
