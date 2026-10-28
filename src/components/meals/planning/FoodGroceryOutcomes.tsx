"use client";
import * as React from "react";
import Link from "next/link";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { useTranslation } from "@/i18n";
import { useFoodPlanningPresentationText } from "@/i18n/food-planning-presentation";
import { formatScheduleInstant } from "@/lib/calendar-planning/schedule-form";
import type {
  FoodGroceryOutcomes,
  FoodGroceryUndo,
} from "@/lib/food-planning/grocery-outcomes-contract";
export function FoodGroceryOutcomesView({
  outcome,
  undos,
  readError,
  busy,
  onRead,
  onUndo,
}: {
  outcome?: FoodGroceryOutcomes;
  undos?: Record<string, FoodGroceryUndo | "unknown">;
  readError?: boolean;
  busy: boolean;
  onRead: () => void;
  onUndo: (id: string) => void;
}) {
  const router = useDraftAwareRouter();
  const { locale } = useTranslation();
  const text = useFoodPlanningPresentationText();
  const [position, setPosition] = React.useState(0);
  const index = Math.min(
    position,
    Math.max(0, (outcome?.outcomes.length ?? 1) - 1),
  );
  const row = outcome?.outcomes[index],
    result = row?.result;
  const undo = row && undos?.[row.requestId];
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!result) return;
    setNow(Date.now());
    const remaining = Date.parse(result.undoExpiresAt) - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(remaining + 1, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [result]);
  return (
    <section
      className="space-y-3 border-t border-[var(--surface-separator)] pt-3"
      aria-label={text("groceryResults")}
    >
      <button
        type="button"
        className="btn-secondary min-h-[44px]"
        disabled={busy}
        onClick={onRead}
      >
        {text("groceryRead")}
      </button>
      {readError && (
        <p role="status">
          {text("groceryReadFailed")}
        </p>
      )}
      {row && (
        <>
          <p className="text-footnote text-label-secondary">
            {text("groceryReceipt")}
          </p>
          {result ? (
            <>
              <p className="font-semibold break-words">{result.listName}</p>
              <p>
                {text("groceryAdded")}: {result.createdCount} ·{" "}
                {text("groceryAlreadyOpen")}:{" "}
                {result.alreadyOnListCount}
              </p>
              {(result.possibleDuplicates.length > 0 ||
                result.possibleDuplicatesTruncated) && (
                <p>
                  {text("groceryLookalikes")}
                  : {result.possibleDuplicates.length}
                  {result.possibleDuplicatesTruncated ? "+" : ""}.{" "}
                  {text("groceryNoMerge")}
                </p>
              )}
              <p className="text-footnote">
                {text("groceryUndoUntil")}:{" "}
                {formatScheduleInstant(result.undoExpiresAt, locale, "UTC")}
              </p>
              {undo === "unknown" && (
                <p role="status">
                  {text("groceryUndoUnknown")}
                </p>
              )}
              {undo && undo !== "unknown" && (
                <p role="status">
                  {undo.result.kind === "done"
                    ? `${text("groceryRemoved")}: ${undo.result.removedCount} · ${text("groceryKept")}: ${undo.result.keptCheckedCount}`
                    : undo.result.code === "UNDO_WINDOW_EXPIRED"
                      ? text("groceryUndoExpired")
                      : text("groceryUndoRefused")}
                </p>
              )}
              {now < Date.parse(result.undoExpiresAt) &&
                result.createdCount > 0 &&
                (!undo ||
                  undo === "unknown" ||
                  undo.result.kind === "refused") && (
                  <button
                    type="button"
                    className="btn-secondary min-h-[44px]"
                    disabled={busy}
                    onClick={() => onUndo(row.requestId)}
                  >
                    {undo === "unknown"
                      ? text("groceryRetryUndo")
                      : text("groceryUndo")}
                  </button>
                )}
            </>
          ) : (
            <p>
              {text("groceryUnavailable")}
            </p>
          )}
          <Link
            className="btn-secondary min-h-[44px] inline-flex"
            href={`/dashboard/lists/${encodeURIComponent(row.listId)}`}
            onClick={(event) => {
              event.preventDefault();
              if (!busy)
                void router.push(
                  `/dashboard/lists/${encodeURIComponent(row.listId)}`,
                );
            }}
          >
            {text("groceryOpen")}
          </Link>
          {outcome!.outcomes.length > 1 && (
            <div className="flex justify-between items-center gap-2">
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                disabled={busy || index === 0}
                onClick={() => setPosition(index - 1)}
              >
                {text("groceryPrevious")}
              </button>
              <span aria-live="polite">
                {index + 1}/{outcome!.outcomes.length}
              </span>
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                disabled={busy || index + 1 === outcome!.outcomes.length}
                onClick={() => setPosition(index + 1)}
              >
                {text("groceryNext")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
