"use client";
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { useFoodPlanningInputsText } from "@/i18n/food-planning-inputs";
import { readFoodOptions, FoodOwnerChanged } from "@/lib/food-planning/client";
import {
  FOOD_OPTIONS_PAGE,
  foodOptionsQuery,
  type FoodOptionsQuery,
  type FoodOptionsReply,
  type FoodOption,
} from "@/lib/food-planning/options-contract";
import type { FoodRecoveryContext } from "@/lib/food-planning/recovery-contract";
import { formatScheduleInstant } from "@/lib/calendar-planning/schedule-form";
/** Read-only selector. Parent edits its owned draft; no app mutation runs here. */
export function FoodRecordPicker({
  kind,
  label,
  emptyLabel,
  values,
  context,
  onChange,
  onFailure,
  disabled = false,
  multiple = false,
  range,
  zone = "UTC",
}: {
  kind: FoodOptionsQuery["kind"];
  label: string;
  emptyLabel: string;
  values: string[];
  context: FoodRecoveryContext;
  onChange: (ids: string[]) => void;
  onFailure: (error: unknown) => void;
  disabled?: boolean;
  multiple?: boolean;
  range?: FoodOptionsQuery["range"];
  zone?: string;
}) {
  const { locale } = useTranslation();
  const text = useFoodPlanningInputsText();
  const [open, setOpen] = React.useState(false),
    [search, setSearch] = React.useState(""),
    [submitted, setSubmitted] = React.useState(""),
    [offset, setOffset] = React.useState(0),
    [attempt, setAttempt] = React.useState(0),
    [reply, setReply] = React.useState<FoodOptionsReply | null>(null),
    [error, setError] = React.useState(false),
    [loading, setLoading] = React.useState(false);
  const latest = React.useRef({ values, context, onFailure, range });
  latest.current = { values, context, onFailure, range };
  const searchRef = React.useRef<HTMLInputElement>(null),
    scope = context.owner?.scope;
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setReply(null);
    setError(false);
    setLoading(true);
    const current = latest.current;
    let query: FoodOptionsQuery;
    try {
      query = foodOptionsQuery.parse({
        kind,
        search: submitted,
        offset,
        selectedIds: current.values,
        range: kind === "departures" ? current.range : undefined,
      });
    } catch {
      setError(true);
      setLoading(false);
      return;
    }
    void readFoodOptions(query, current.context)
      .then((result) => {
        if (active) setReply(result);
      })
      .catch((cause) => {
        if (active) {
          setError(true);
          if (cause instanceof FoodOwnerChanged)
            latest.current.onFailure(cause);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, kind, submitted, offset, attempt, scope]);
  const known = [...(reply?.selected ?? []), ...(reply?.items ?? [])];
  function title(row: FoodOption) {
    return row.kind === "person" || row.kind === "list"
      ? row.name
      : row.title || text("untitledEvent");
  }
  function detail(row: FoodOption) {
    if (row.kind === "recipe")
      return `${row.servings} ${text("baseServings")} · ${row.minutes === null ? text("timeUnrecorded") : `${row.minutes} min`}`;
    if (row.kind === "person")
      return row.role === "child"
        ? text("childAccount")
        : row.role === "teen"
          ? text("teenAccount")
          : text("householdAccount");
    if (row.kind === "list")
      return row.type === "grocery"
        ? text("groceryList")
        : text("shoppingList");
    return `${formatScheduleInstant(row.start, locale, zone)}${row.repeating ? text("repeatingReview") : ""}`;
  }
  function choose(id: string) {
    if (disabled) return;
    if (!multiple) {
      onChange([id]);
      setOpen(false);
      return;
    }
    onChange(
      values.includes(id)
        ? values.filter((value) => value !== id)
        : values.length < 50
          ? [...values, id]
          : values,
    );
  }
  const selectedLabel = !values.length
    ? emptyLabel
    : values.length === 1 && known.find((row) => row.id === values[0])
      ? title(known.find((row) => row.id === values[0])!)
      : `${values.length} ${text("selected")}`;
  return (
    <div className="space-y-1 min-w-0">
      <p className="text-subhead font-semibold">{label}</p>
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="btn-secondary min-h-[44px] min-w-0 flex-1 whitespace-normal break-words text-left"
          disabled={disabled}
          aria-label={`${label}: ${selectedLabel}`}
          onClick={() => {
            setOffset(0);
            setOpen(true);
          }}
        >
          {selectedLabel}
        </button>
        {values.length > 0 && (
          <button
            type="button"
            className="btn-secondary min-h-[44px]"
            disabled={disabled}
            aria-label={`${text("clearSelection")}: ${label}`}
            onClick={() => onChange([])}
          >
            {text("clear")}
          </button>
        )}
      </div>
      <Dialog
        open={open}
        variant="form"
        title={label}
        onClose={() => setOpen(false)}
        closeLabel={text("closePicker")}
        initialFocusRef={searchRef}
        footer={
          <button
            type="button"
            className="btn-filled min-h-[44px]"
            onClick={() => setOpen(false)}
          >
            {text("done")}
          </button>
        }
      >
        <div className="space-y-3" aria-busy={loading}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setOffset(0);
              setSubmitted(search);
              setAttempt((value) => value + 1);
            }}
            className="flex items-end gap-2"
          >
            <label className="min-w-0 flex-1">
              {text("searchHousehold")}
              <input
                ref={searchRef}
                className="input-apple min-h-[44px] w-full"
                value={search}
                maxLength={100}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="btn-secondary min-h-[44px]"
            >
              {text("search")}
            </button>
          </form>
          {loading && (
            <p role="status">
              {text("loadingChoices")}
            </p>
          )}
          {error && (
            <div role="alert">
              <p>
                {text("readFailed")}
              </p>
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {text("retryRead")}
              </button>
            </div>
          )}
          {reply && (
            <>
              <p className="text-footnote text-label-secondary">
                {kind === "departures"
                  ? text("eventCoverage")
                  : kind === "people"
                    ? text("accountBoundary")
                    : multiple
                      ? text("recipeLimit")
                      : text("chooseRecord")}
              </p>
              {reply.items.length === 0 && (
                <p role="status">
                  {text("noMatches")}
                </p>
              )}
              <ul className="space-y-2">
                {reply.items.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="btn-secondary min-h-[44px] w-full whitespace-normal text-left flex flex-col items-start"
                      aria-pressed={values.includes(row.id)}
                      disabled={
                        disabled ||
                        (multiple &&
                          values.length >= 50 &&
                          !values.includes(row.id))
                      }
                      onClick={() => choose(row.id)}
                    >
                      <span className="font-semibold break-words">
                        {values.includes(row.id) ? "✓ " : ""}
                        {title(row)}
                      </span>
                      <span className="text-footnote font-normal break-words">
                        {detail(row)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={loading || offset === 0}
                  onClick={() => setOffset(offset - FOOD_OPTIONS_PAGE)}
                >
                  {text("previousChoices")}
                </button>
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  disabled={loading || !reply.hasMore || offset >= 10000}
                  onClick={() => setOffset(offset + FOOD_OPTIONS_PAGE)}
                >
                  {text("moreChoices")}
                </button>
              </div>
              {offset >= 10000 && reply.hasMore && (
                <p>
                  {text("narrowSearch")}
                </p>
              )}
            </>
          )}
        </div>
      </Dialog>
    </div>
  );
}
