"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "@/i18n";
import {
  useFoodPlanningPresentationText,
  type FoodPlanningPresentationKey,
} from "@/i18n/food-planning-presentation";
import { formatRecipeAmount } from "@/lib/recipe-scaling";
import { foodPlanView } from "@/lib/food-planning/view-contract";
import type { FoodPlan, FoodTimingResult } from "@/lib/food-planning/contract";
import { formatScheduleInstant } from "@/lib/calendar-planning/schedule-form";
const labels = {
  "slot-occupied": "holdSlotOccupied",
  "recipe-unavailable": "holdRecipeUnavailable",
  "no-recipe": "holdNoRecipe",
  "time-unknown": "holdTimeUnknown",
  "time-exceeded": "holdTimeExceeded",
  "ingredients-unknown": "holdIngredientsUnknown",
  "source-incomplete": "holdSourceIncomplete",
  "commitments-unresolved": "holdCommitmentsUnresolved",
  "calendar-unknown": "holdCalendarUnknown",
  "calendar-conflict": "holdCalendarConflict",
} satisfies Record<
  FoodPlan["slots"][number]["holds"][number],
  FoodPlanningPresentationKey
>;
const commitmentReasons = {
  "recipe-unknown": "commitmentRecipeUnknown",
  "ingredients-unknown": "commitmentIngredientsUnknown",
  "quantity-unknown": "commitmentQuantityUnknown",
  "prep-state-unknown": "commitmentPrepStateUnknown",
  "overdue-prep": "commitmentOverduePrep",
} satisfies Record<
  FoodPlan["commitments"]["entries"][number]["holds"][number],
  FoodPlanningPresentationKey
>;
/** Person-only projection supplied by the caller. Does not fetch, save, consume
 * or persist source data; edited alternatives must go through a fresh preview. */
export function FoodPlanSummary({
  plan: raw,
  mode,
  busy = false,
  onChooseRecipe,
  detailsForChoice,
  timeZone,
  onReusePrepared,
  onOpenCommitment,
}: {
  plan: FoodPlan;
  mode: "meals" | "prep";
  busy?: boolean;
  timeZone?: string;
  onReusePrepared?: (target: { sessionId: string; batchId: string }) => void;
  onOpenCommitment?: (target: {
    kind: "meal" | "prep-dish";
    date: string;
  }) => void;
  onChooseRecipe?: (slotKey: string, recipeId: string) => void;
  detailsForChoice?: (key: string) => React.ReactNode;
}) {
  const { locale } = useTranslation();
  const text = useFoodPlanningPresentationText();
  const plan = foodPlanView.parse(raw);
  const [position, setPosition] = React.useState(0);
  const index = Math.min(position, plan.slots.length - 1),
    row = plan.slots[index],
    choice = row.choice;
  const quantity = (value: number | null, unit: string | null) =>
    value === null
      ? text("unknownQuantity")
      : (formatRecipeAmount(value, unit, locale) ??
        text("unknownQuantity"));
  return (
    <section
      aria-label={text("reviewPlan")}
      className="space-y-4"
    >
      <p className="text-subhead text-label-secondary">
        {text("estimates")}
      </p>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-secondary min-h-[44px] min-w-[44px]"
          disabled={busy || index === 0}
          onClick={() => setPosition(index - 1)}
          aria-label={text("previousChoice")}
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </button>
        <p aria-live="polite" className="text-subhead font-semibold">
          {text("choice")} {index + 1} / {plan.slots.length}
        </p>
        <button
          type="button"
          className="btn-secondary min-h-[44px] min-w-[44px]"
          disabled={busy || index + 1 === plan.slots.length}
          onClick={() => setPosition(index + 1)}
          aria-label={text("nextChoice")}
        >
          <ChevronRight aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <article
        className="card-apple space-y-3 p-4"
        aria-label={
          choice?.title ?? text("unavailableChoice")
        }
      >
        <h3 className="text-title3 font-semibold break-words">
          {choice?.title ?? text("chooseOtherRecipe")}
        </h3>
        {choice && (
          <>
            <p>
              {choice.servings} {text("servings")} ·{" "}
              {choice.totalMinutes === null
                ? text("timeUnknown")
                : `${choice.totalMinutes} min`}
            </p>
            {choice.totalMinutes === null &&
              choice.authoredMinutes !== null && (
                <p className="text-subhead text-label-secondary">
                  {text("recordedTime")}
                  : {choice.authoredMinutes} min / {choice.baseServings}{" "}
                  {text("scalingTime")}
                </p>
              )}
            {mode === "meals" && choice.schedule && (
              <TimingSummary
                timing={choice.schedule}
                zone={timeZone}
                locale={locale}
              />
            )}
            <details>
              <summary className="min-h-[44px] cursor-pointer py-3 font-semibold">
                {text("ingredientsStock")}{" "}
                ({choice.ingredients.length})
              </summary>
              <PagedList key={row.key}>
                {choice.ingredients.map((line) => (
                  <li
                    key={line.ingredientId}
                    className="border-t border-[var(--separator)] pt-3 break-words"
                  >
                    <p className="font-semibold">{line.name}</p>
                    <p className="text-subhead">
                      {text("needed")}:{" "}
                      {quantity(line.required, line.unit)} ·{" "}
                      {text("comparableStock")}
                      : {quantity(line.recordedAvailable, line.unit)}
                    </p>
                    <p className="text-subhead text-label-secondary">
                      {line.state === "check"
                        ? text("checkQuantity")
                        : line.state === "shortfall"
                          ? `${text("shortfall")}: ${quantity(line.shortfall, line.unit)}`
                          : text("stockCovers")}
                      {line.match === "name" && (
                        <>
                          {" "}
                          {text("matchedByName")}
                        </>
                      )}
                      {line.useSoon && (
                        <>
                          {" "}
                          {text("useSoon")}
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </PagedList>
            </details>
          </>
        )}
        {row.holds.length > 0 && (
          <div
            role="status"
            className="rounded-xl bg-[var(--surface-fill)] p-3"
          >
            <p className="font-semibold">
              {text("reviewBeforeSave")}
            </p>
            <ul className="list-disc pl-5">
              {row.holds.map((hold) => (
                <li key={hold}>{text(labels[hold])}</li>
              ))}
            </ul>
          </div>
        )}
        {detailsForChoice?.(row.key)}
        {onChooseRecipe && row.alternatives.length > 0 && (
          <details>
            <summary className="min-h-[44px] cursor-pointer py-3 font-semibold">
              {text("otherRecipes")}
            </summary>
            <div className="space-y-2">
              {row.alternatives.map((alternative) => (
                <button
                  key={alternative.recipeId}
                  type="button"
                  disabled={busy}
                  className="btn-secondary min-h-[44px] w-full whitespace-normal text-left"
                  onClick={() => onChooseRecipe(row.key, alternative.recipeId)}
                >
                  {alternative.title}
                </button>
              ))}
            </div>
          </details>
        )}
      </article>
      {mode === "prep" && (
        <p className="text-subhead">
          {text("sequentialPrep")}
          :{" "}
          {plan.prepMinutes === null
            ? text("unknownPrep")
            : `${plan.prepMinutes} min`}
          .{" "}
          {plan.prepTime === "over-requested-limit" &&
            text("prepLimit")}{" "}
          {plan.prepSchedule?.state === "conflict" &&
            text("prepConflict")}
          {plan.prepSchedule?.state === "unknown" &&
            text("prepCalendarUnknown")}
        </p>
      )}
      {mode === "prep" && plan.prepSchedule && (
        <TimingSummary
          timing={plan.prepSchedule}
          zone={timeZone}
          locale={locale}
        />
      )}
      <details>
        <summary className="min-h-[44px] cursor-pointer py-3 font-semibold">
          {text("existingCommitments")} (
          {plan.commitments.entries.length})
        </summary>
        {!plan.existingMealReservationsChecked ? (
          <p>
            {text("reservationsUnchecked")}
          </p>
        ) : (
          <>
            {!plan.commitments.complete && (
              <p role="status">
                {text("quantitiesUnresolved")}
              </p>
            )}
            <PagedList>
              {plan.commitments.entries.map((entry) => (
                <li key={entry.id} className="break-words">
                  <p className="font-semibold">
                    {entry.label ??
                      text("unnamedMeal")}
                  </p>
                  <p className="text-subhead">
                    {entry.originalDate} ·{" "}
                    {entry.servings !== null &&
                    Number.isInteger(entry.servings) &&
                    entry.servings > 0 &&
                    entry.servings <= 100
                      ? entry.servings
                      : text("unknownServings")}{" "}
                    {text("servings")}
                    {entry.servingsBasis === "recipe-default" && (
                      <>
                        {" "}
                        ·{" "}
                        {text("recipeDefault")}
                      </>
                    )}
                    {entry.holds.length > 0 && (
                      <> · {text("needsReview")}</>
                    )}
                  </p>
                  {entry.holds.length > 0 && (
                    <details className="mt-2">
                      <summary className="min-h-11 cursor-pointer py-2">
                        {text("whyReview")}
                      </summary>
                      <ul className="list-disc space-y-1 pl-5 text-subhead">
                        {entry.holds.map((hold) => (
                          <li key={hold}>{text(commitmentReasons[hold])}</li>
                        ))}
                      </ul>
                      <p className="text-footnote text-label-secondary mt-2">
                        {text("correctSources")}
                      </p>
                      {onOpenCommitment && (
                        <button
                          type="button"
                          className="btn-secondary min-h-[44px] mt-2"
                          disabled={busy}
                          onClick={() =>
                            onOpenCommitment({
                              kind: entry.kind,
                              date: entry.originalDate,
                            })
                          }
                        >
                          {entry.kind === "meal"
                            ? text("openMeals")
                            : text("openPrep")}
                        </button>
                      )}
                    </details>
                  )}
                </li>
              ))}
            </PagedList>
          </>
        )}
      </details>
      {plan.commitments.prepared.length > 0 && (
        <details>
          <summary className="min-h-[44px] cursor-pointer py-3 font-semibold">
            {text("preparedPortions")}{" "}
            ({plan.commitments.prepared.length})
          </summary>
          <p className="text-subhead text-label-secondary">
            {text("freshness")}
          </p>
          <PagedList>
            {plan.commitments.prepared.map((dish) => (
              <li key={dish.batchId} className="break-words">
                <p className="font-semibold">{dish.name}</p>
                <p className="text-subhead">
                  {dish.eaten} {text("eaten")} · {dish.planned}{" "}
                  {text("planned")} · {dish.remaining}{" "}
                  {text("remaining")} · {dish.unplanned}{" "}
                  {text("unplanned")}
                </p>
                <p className="text-subhead text-label-secondary">
                  {dish.storage === "freezer"
                    ? text("freezer")
                    : text("fridge")}{" "}
                  · {text("prepDay")}: {dish.preparedOn}
                  {dish.nextPrepOn && (
                    <>
                      {" "}
                      · {text("nextPrep")}:{" "}
                      {dish.nextPrepOn}
                    </>
                  )}
                </p>
                {onReusePrepared && dish.unplanned > 0 && (
                  <button
                    type="button"
                    className="btn-secondary min-h-[44px] mt-2"
                    disabled={busy}
                    onClick={() =>
                      onReusePrepared({
                        sessionId: dish.sessionId,
                        batchId: dish.batchId,
                      })
                    }
                  >
                    {text("planPortions")}
                  </button>
                )}
              </li>
            ))}
          </PagedList>
          {onOpenCommitment && (
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              disabled={busy}
              onClick={() =>
                onOpenCommitment({
                  kind: "prep-dish",
                  date: plan.commitments.prepared[0].preparedOn,
                })
              }
            >
              {text("managePortions")}
            </button>
          )}
        </details>
      )}
    </section>
  );
}

/** Expandable detail pages stay short even with a full bounded source graph. */
function PagedList({
  children,
}: {
  children: React.ReactNode[];
}) {
  const text = useFoodPlanningPresentationText();
  const [page, setPage] = React.useState(0);
  const last = Math.max(0, Math.ceil(children.length / 5) - 1);
  const current = Math.min(page, last);
  return (
    <div className="space-y-2">
      <ul className="space-y-3 py-3">
        {children.slice(current * 5, current * 5 + 5)}
      </ul>
      {last > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="btn-secondary min-h-[44px]"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {text("previousRecords")}
          </button>
          <p aria-live="polite" className="text-subhead">
            {current + 1} / {last + 1}
          </p>
          <button
            type="button"
            className="btn-secondary min-h-[44px]"
            disabled={current === last}
            onClick={() => setPage(current + 1)}
          >
            {text("nextRecords")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Display exact source instants without inferring a household timezone. */
function TimingSummary({
  timing,
  zone,
  locale,
}: {
  timing: FoodTimingResult;
  zone?: string;
  locale: string;
}) {
  const text = useFoodPlanningPresentationText();
  if (timing.state === "not-requested") return null;
  const instant = (value: string) =>
    zone ? formatScheduleInstant(value, locale, zone) : `${value} (UTC)`;
  return (
    <div className="space-y-1 text-subhead">
      <p>
        {timing.state === "fits"
          ? text("timeFits")
          : text("timeReview")}
      </p>
      {timing.state === "fits" && timing.start && timing.finish && (
        <p>
          {text("estimatedStart")}: {instant(timing.start)}{" "}
          ·{" "}
          {text("finishBuffers")}
          : {instant(timing.finish)}
        </p>
      )}
      {timing.readyBy && (
        <p>
          {text("readyBy")}: {instant(timing.readyBy)}
        </p>
      )}
      {timing.departure && (
        <p className="break-words">
          {text("departure")}: {timing.departure.title} ·{" "}
          {instant(timing.departure.start)}
        </p>
      )}
    </div>
  );
}
