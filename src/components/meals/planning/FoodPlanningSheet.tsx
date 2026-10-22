"use client";
import * as React from "react";
import Link from "next/link";
import { preparedReuseHref } from "@/lib/prepared-meal-reuse";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
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
  const session = useFoodPlanningSession(onSaved),
    latest = React.useRef(session),
    { locale } = useTranslation(),
    es = locale === "es",
    copy = (en: string, spanish: string) => (es ? spanish : en);
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
    catalog: copy(
      "Choose a pool of up to 50 recipes, then preview again.",
      "Elige un grupo de hasta 50 recetas y vuelve a obtener sugerencias.",
    ),
    load: copy(
      "Could not load saved food work.",
      "No se pudo cargar el trabajo de comidas.",
    ),
    owner: copy(
      "Your account or household changed. Reopen this planner in the current household.",
      "Tu cuenta o tu hogar han cambiado. Vuelve a abrir el planificador en el hogar actual.",
    ),
    storage: copy(
      "Draft storage needs repair. Your original request will not be sent again automatically.",
      "Hay que reparar el almacenamiento. Tu solicitud original no se reenviará automáticamente.",
    ),
    invalid: copy(
      "Check the dates, portions, time choices and current source review. Your draft is kept.",
      "Revisa las fechas, porciones, horarios y datos actuales. Se conserva el borrador.",
    ),
    unknown: copy(
      "The save result is unknown. Inspect the original request before trying again.",
      "Se desconoce el resultado. Comprueba la solicitud original antes de reintentar.",
    ),
    held: copy(
      "Saved work needs attention. Inspect requests or explicitly reload the stored copy.",
      "El trabajo guardado necesita atención. Comprueba las solicitudes o vuelve a cargar la copia guardada.",
    ),
  };
  return (
    <>
      <Dialog
        open
        variant="form"
        title={copy("Plan meals and prep", "Planificar comidas y preparación")}
        closeLabel={copy("Close planner", "Cerrar planificador")}
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
              {copy("Close", "Cerrar")}
            </button>
            {draft && !view && (
              <button
                type="button"
                className="btn-filled min-h-[44px]"
                disabled={disabled}
                onClick={() => void session.previewDraft()}
              >
                {copy("Find suggestions", "Buscar sugerencias")}
              </button>
            )}
            {draft && view && (
              <button
                type="button"
                className="btn-secondary min-h-[44px]"
                disabled={disabled}
                onClick={() => session.change(draft)}
              >
                {copy("Edit choices", "Editar opciones")}
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
                  ? copy("Refresh review", "Actualizar revisión")
                  : copy("Review save", "Revisar antes de guardar")}
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
                {copy("Confirm and save", "Confirmar y guardar")}
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4" aria-busy={session.busy}>
          {session.busy && (
            <p role="status">{copy("Working…", "Procesando…")}</p>
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
                  {copy("Repair saved transition", "Reparar cambio guardado")}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={session.busy}
                  className="btn-secondary min-h-[44px]"
                  onClick={() => setReload(true)}
                >
                  {copy(
                    "Reload saved work",
                    "Volver a cargar trabajo guardado",
                  )}
                </button>
              )}
            </div>
          )}
          {session.context && !session.context.enabled && (
            <p role="status">
              {copy(
                "New planning is paused or unavailable. Saved requests can still be inspected.",
                "La nueva planificación está pausada o no disponible. Puedes comprobar las solicitudes guardadas.",
              )}
            </p>
          )}
          {!draft && session.context?.enabled && (
            <button
              type="button"
              disabled={session.busy}
              className="btn-filled min-h-[44px]"
              onClick={() => void session.start(day, mode)}
            >
              {copy("Start a plan", "Empezar un plan")}
            </button>
          )}
          {draft?.mode === "prep" &&
            session.context &&
            !session.context.canPrep && (
              <p role="status">
                {copy(
                  "Verify your account before saving a prep session. You can keep editing this draft.",
                  "Verifica tu cuenta antes de guardar una sesión de preparación. Puedes seguir editando el borrador.",
                )}
              </p>
            )}
          {draft && !view && slot && (
            <fieldset disabled={disabled} className="space-y-4 min-w-0">
              <legend className="font-semibold">
                {copy("What are you planning?", "¿Qué quieres planificar?")}
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
                      ? copy("Several meals", "Varias comidas")
                      : copy("One prep session", "Una sesión de preparación")}
                  </button>
                ))}
              </div>
              {session.context && (
                <details>
                  <summary className="min-h-[44px] py-3 cursor-pointer">
                    {copy(
                      "Recipe pool (optional)",
                      "Grupo de recetas (opcional)",
                    )}
                  </summary>
                  <p className="text-footnote">
                    {copy(
                      "For a large recipe box, choose up to 50 saved recipes to suggest from.",
                      "Si tienes muchas recetas, elige hasta 50 recetas guardadas para las sugerencias.",
                    )}
                  </p>
                  <FoodRecordPicker
                    kind="recipes"
                    multiple
                    label={copy(
                      "Suggest from these recipes",
                      "Sugerir de estas recetas",
                    )}
                    emptyLabel={copy(
                      "Use the household library",
                      "Usar las recetas del hogar",
                    )}
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
                  {copy("Prioritize", "Priorizar")}
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
                      {copy("Use food soon", "Usar alimentos pronto")}
                    </option>
                    <option value="least-shopping">
                      {copy("Less shopping", "Comprar menos")}
                    </option>
                    <option value="quick">
                      {copy("Shorter recipe time", "Menor tiempo de receta")}
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
                  {copy(
                    "Allow repeated suggestions",
                    "Permitir sugerencias repetidas",
                  )}
                </label>
                {draft.mode === "prep" && (
                  <>
                    <label>
                      {copy("Prep day", "Día de preparación")}
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
                      {copy(
                        "Next prep (optional)",
                        "Próxima preparación (opcional)",
                      )}
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
                  {copy("Previous", "Anterior")}
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
                  {copy("Next", "Siguiente")}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {draft.mode === "meals" && (
                  <>
                    <label>
                      {copy("Day", "Día")}
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
                      {copy("Meal", "Comida")}
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
                          {copy("Breakfast", "Desayuno")}
                        </option>
                        <option value="lunch">
                          {copy("Lunch", "Almuerzo")}
                        </option>
                        <option value="dinner">{copy("Dinner", "Cena")}</option>
                        <option value="snack">
                          {copy("Snack", "Tentempié")}
                        </option>
                      </select>
                    </label>
                  </>
                )}
                <label>
                  {draft.mode === "prep"
                    ? copy("Total dish portions", "Porciones totales del plato")
                    : copy("Servings", "Porciones")}
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
                  {copy(
                    "Recipe time limit (optional minutes)",
                    "Límite de tiempo de receta (minutos opcionales)",
                  )}
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
                      {copy(
                        "Dish label (optional)",
                        "Nombre del plato (opcional)",
                      )}
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
                      {copy(
                        "Store remaining portions",
                        "Guardar porciones restantes",
                      )}
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
                          {copy("Fridge", "Nevera")}
                        </option>
                        <option value="freezer">
                          {copy("Freezer", "Congelador")}
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
                    label={copy("Recipe", "Receta")}
                    emptyLabel={copy(
                      "Suggest automatically",
                      "Sugerir automáticamente",
                    )}
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
                    label={copy(
                      "Cook (optional account)",
                      "Cocinero (cuenta opcional)",
                    )}
                    emptyLabel={copy(
                      "No cook assigned",
                      "Sin cocinero asignado",
                    )}
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
                    {copy(
                      "This recipe is outside your selected pool. Add it to the pool or clear this choice.",
                      "Esta receta no está en el grupo seleccionado. Añádela al grupo o quita esta selección.",
                    )}
                  </p>
                )}
              {draft.mode === "meals" && (
                <details>
                  <summary className="min-h-[44px] py-3 cursor-pointer">
                    {copy(
                      "Notes and cooking window",
                      "Notas e intervalo para cocinar",
                    )}
                  </summary>
                  <label>
                    {copy("Notes (optional)", "Notas (opcionales)")}
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
                    es={es}
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
                    {copy("Session timing", "Horario de la sesión")}
                  </summary>
                  <label>
                    {copy(
                      "Total session limit (optional minutes)",
                      "Límite de sesión (minutos opcionales)",
                    )}
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
                    es={es}
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
                    ? copy("Add dish", "Añadir plato")
                    : copy("Add meal", "Añadir comida")}
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
                  {copy("Remove this choice", "Quitar esta opción")}
                </button>
              </div>
              <p className="text-footnote text-label-secondary">
                {copy(
                  "Suggestions use saved household recipes and recorded food. No stock is consumed and no grocery items are added by preview.",
                  "Las sugerencias usan recetas y alimentos registrados del hogar. La vista previa no consume existencias ni añade artículos a la compra.",
                )}
              </p>
            </fieldset>
          )}
          {view && draft && (
            <FoodPlanSummary
              plan={view.plan}
              timeZone={draft.timeZone}
              mode={draft.mode}
              busy={session.busy}
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
                {copy("Confirm the exact save", "Confirmar lo que se guardará")}
              </h3>
              <p>
                {session.review.input.mode === "meals"
                  ? `${session.review.input.meals.length} ${copy("new meals", "comidas nuevas")}`
                  : `${session.review.input.input.dishes.length} ${copy("dishes in one unprepared session", "platos en una sesión aún no preparada")}`}
              </p>
              <p>
                {session.review.groceries.length
                  ? copy(
                      "Selected groceries use full recipe quantities, not estimated shortfalls.",
                      "La compra seleccionada usa cantidades completas de receta, no déficits estimados.",
                    )
                  : copy(
                      "No grocery items will be added.",
                      "No se añadirán artículos a la compra.",
                    )}
              </p>
              <p className="text-footnote">
                {copy(
                  "The review expires after one minute. Refresh it if needed; nothing is saved until you confirm.",
                  "La revisión vence tras un minuto. Actualízala si es necesario; no se guarda nada hasta confirmar.",
                )}
              </p>
            </section>
          )}
          {session.rows.filter((entry) => entry.kind === "food-plan").length >
            0 && (
            <section className="space-y-3">
              <h3 className="font-semibold">
                {copy("Saved requests", "Solicitudes guardadas")}
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
                        {copy("Food request", "Solicitud de comidas")} {i + 1}
                      </p>
                      <p>
                        {committed
                          ? copy(
                              "Save confirmed. Records may have changed since then.",
                              "Guardado confirmado. Los registros pueden haber cambiado después.",
                            )
                          : copy(
                              "Outcome unconfirmed. Missing or expired receipts do not prove the save failed.",
                              "Resultado sin confirmar. Que el recibo falte o venza no demuestra que fallara el guardado.",
                            )}
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
                          {copy("Inspect receipt", "Comprobar recibo")}
                        </button>
                        {proof?.retryEligible && (
                          <button
                            type="button"
                            className="btn-filled min-h-[44px]"
                            disabled={session.busy}
                            onClick={() => void session.retry(entry.key)}
                          >
                            {copy(
                              "Retry exact request",
                              "Reintentar solicitud exacta",
                            )}
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
                            ? copy(
                                "Dismiss saved receipt",
                                "Quitar recibo guardado",
                              )
                            : copy(
                                "Forget local request…",
                                "Olvidar solicitud local…",
                              )}
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
              {copy("Discard editable draft…", "Descartar borrador editable…")}
            </button>
          )}
          <Link
            href="/dashboard/meals?view=bulk"
            className="inline-flex min-h-[44px] items-center text-[var(--accent-text)]"
          >
            {copy(
              "Manage prepared meals and eaten portions",
              "Gestionar comidas preparadas y porciones consumidas",
            )}
          </Link>
        </div>
      </Dialog>
      <Dialog
        open={forget !== null || reload}
        role="alertdialog"
        title={
          reload
            ? copy(
                "Reload stored work?",
                "¿Volver a cargar el trabajo guardado?",
              )
            : copy("Remove local work?", "¿Quitar trabajo local?")
        }
        closeLabel={copy("Keep working", "Seguir trabajando")}
        onClose={() => {
          setForget(null);
          setReload(false);
        }}
      >
        <p>
          {reload
            ? copy(
                "Unsaved changes in this view will be replaced by the stored copy. No server records are removed.",
                "La copia guardada reemplazará los cambios sin guardar de esta vista. No se eliminan registros del servidor.",
              )
            : copy(
                "This removes local work only. An unconfirmed save or grocery Undo may already have finished. Inspect it first. Removing this entry does not change server records.",
                "Esto solo quita el trabajo local. Un guardado o deshacer sin confirmar puede haber terminado. Compruébalo primero. Quitar esta entrada no cambia los registros del servidor.",
              )}
        </p>
        <label className="flex min-h-[44px] items-center gap-2">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          {copy("I understand", "Entiendo")}
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
            {copy("Keep working", "Seguir trabajando")}
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
              ? copy("Reload saved copy", "Cargar copia guardada")
              : copy("Remove locally", "Quitar localmente")}
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
  es,
  onChange,
}: {
  value: FoodEditorSlot["timing"];
  zone: string;
  context: FoodRecoveryContext | null;
  onFailure: (error: unknown) => void;
  disabled: boolean;
  es: boolean;
  onChange: (next: FoodEditorSlot["timing"]) => void;
}) {
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
        {es ? "Comprobar un intervalo para cocinar" : "Check a cooking window"}
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
                  {key === "start"
                    ? es
                      ? "Inicio"
                      : "Start"
                    : es
                      ? "Fin"
                      : "End"}
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
                      aria-label={
                        es ? "Elegir desfase horario" : "Choose time offset"
                      }
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
                        {es ? "Elige una hora exacta" : "Choose an exact time"}
                      </option>
                      {choices.map((choice) => (
                        <option key={choice} value={choice}>
                          {formatScheduleInstant(
                            choice,
                            es ? "es" : "en",
                            zone,
                          )}
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
              label={
                es
                  ? "Salida que limita el horario (opcional)"
                  : "Departure deadline (optional)"
              }
              emptyLabel={
                es ? "Sin salida seleccionada" : "No departure selected"
              }
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
              {es
                ? "Completa un intervalo exacto para elegir una salida del calendario."
                : "Complete an unambiguous window to choose a calendar departure."}
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
              {es ? "Quitar salida y márgenes" : "Clear departure and buffers"}
            </button>
          )}
          {(value.departureId ||
            value.travel !== "0" ||
            value.departurePreparation !== "0") && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(["travel", "departurePreparation"] as const).map((key) => (
                <label key={key}>
                  {key === "travel"
                    ? es
                      ? "Viaje (min)"
                      : "Travel (min)"
                    : es
                      ? "Prepararse para salir (min)"
                      : "Getting ready to leave (min)"}
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
                  ? es
                    ? "Preparación extra (min)"
                    : "Extra setup (min)"
                  : key === "eating"
                    ? es
                      ? "Comer (min)"
                      : "Eating (min)"
                    : es
                      ? "Limpiar (min)"
                      : "Cleanup (min)"}
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
