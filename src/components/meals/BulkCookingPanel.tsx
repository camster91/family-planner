"use client";
import * as React from "react";
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
import {
  MealPrepActionSheet,
  type PrepActionKind,
} from "./MealPrepActionSheet";

export function BulkCookingPanel({
  defaultDay,
  refreshKey,
  onMealsChanged,
  onContext,
}: {
  defaultDay: string;
  refreshKey: unknown;
  onMealsChanged: () => void;
  onContext: (scope: MealPrepContext | null) => void;
}) {
  const tBulk = useBulkCookingText();
  const locale = useDisplayLocale();
  const id = React.useId();
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
  } | null>(null);
  const [modal, setModal] = React.useState<{
    kind: PrepActionKind;
    sessionId: string;
    batchId?: string;
    consumptionId?: string;
  } | null>(null);
  const request = React.useRef(0);
  const onContextRef = React.useRef(onContext);
  onContextRef.current = onContext;
  const load = React.useCallback(
    async (next?: string): Promise<MealPrepSummary[] | null> => {
      const version = ++request.current;
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
        const target = preferredSession.current ?? selectedRef.current;
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
    void load();
  }, [load, refreshKey]);
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
  const saved = (sessionId?: string) => {
    if (sessionId) preferredSession.current = sessionId;
    setEditor(null);
    setModal(null);
    void load().then((latest) => {
      if (sessionId && latest?.some((row) => row.id === sessionId))
        setSelected(sessionId);
    });
    onMealsChanged();
  };
  return (
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
          disabled={!scope || forbidden || loading}
          onClick={() => setEditor({ day: defaultDay })}
        >
          {tBulk("add")}
        </button>
      </div>
      {forbidden ? (
        <p className="text-subhead text-label-secondary">{tBulk("forbidden")}</p>
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
              >
                {tBulk("markPrepared")}
              </button>
            )}
          </div>
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
                  className="rounded-xl border border-[var(--surface-separator)] bg-[var(--surface-card)] p-4 space-y-3 min-w-0"
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
                    <button
                      type="button"
                      className="btn-tinted min-h-[44px]"
                      disabled={counts.unplanned <= 0}
                      onClick={() =>
                        setModal({
                          kind: "allocate",
                          sessionId: current.id,
                          batchId: batch.id,
                        })
                      }
                    >
                      {tBulk("schedule")}
                    </button>
                    <button
                      type="button"
                      className="btn-tinted min-h-[44px]"
                      disabled={!current.prepared_at || counts.remaining <= 0}
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
                  {batch.recipe_id && !current.prepared_at && (
                    <AddToGroceriesButton
                      recipeId={batch.recipe_id}
                      batchId={batch.id}
                      label={tBulk("groceries")}
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
                onClick={() =>
                  setModal({ kind: "next-prep", sessionId: current.id })
                }
              >
                {tBulk("changeNext")}
              </button>
              {current.next_prep_on && (
                <button
                  type="button"
                  className="btn-filled min-h-[44px]"
                  onClick={() =>
                    setEditor({
                      day: toDateOnlyUTC(current.next_prep_on!),
                      seed: current,
                    })
                  }
                >
                  {tBulk("planNext")}
                </button>
              )}
            </div>
          </div>
          <p className="text-footnote text-label-secondary">
            {tBulk("planningNote")}
          </p>
          {cursor && (
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              disabled={loading}
              onClick={() => void load(cursor)}
            >
              {tBulk("more")}
            </button>
          )}
        </>
      )}
      {scope && editor && (
        <MealPrepEditor
          context={scope}
          defaultDay={editor.day}
          seed={editor.seed}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {scope && modal && modalSession && (
        <MealPrepActionSheet
          kind={modal.kind}
          context={scope}
          session={modalSession}
          batch={modalSession.batches.find((row) => row.id === modal.batchId)}
          consumptionId={modal.consumptionId}
          onClose={() => setModal(null)}
          onSaved={() => saved()}
          onReload={() => load()}
        />
      )}
    </section>
  );
}
