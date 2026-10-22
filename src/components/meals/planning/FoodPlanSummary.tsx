"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "@/i18n";
import { formatRecipeAmount } from "@/lib/recipe-scaling";
import { foodPlanView } from "@/lib/food-planning/view-contract";
import type { FoodPlan } from "@/lib/food-planning/contract";
const labels = {
  "slot-occupied": [
    "This meal slot already has a plan.",
    "Esta comida ya tiene un plan.",
  ],
  "recipe-unavailable": [
    "The selected recipe is unavailable.",
    "La receta elegida no está disponible.",
  ],
  "no-recipe": [
    "No saved recipe is available for this choice.",
    "No hay una receta guardada para esta opción.",
  ],
  "time-unknown": [
    "Cooking time needs checking.",
    "Hay que comprobar el tiempo de cocina.",
  ],
  "time-exceeded": [
    "This exceeds your time limit.",
    "Esto supera tu límite de tiempo.",
  ],
  "ingredients-unknown": [
    "Ingredient details need checking.",
    "Hay que comprobar los ingredientes.",
  ],
  "source-incomplete": [
    "Some household sources could not be checked.",
    "No se pudieron comprobar algunos datos del hogar.",
  ],
  "commitments-unresolved": [
    "Review existing meal commitments first.",
    "Revisa primero las comidas ya planificadas.",
  ],
  "calendar-unknown": [
    "Calendar availability could not be established.",
    "No se pudo comprobar la disponibilidad del calendario.",
  ],
  "calendar-conflict": [
    "No continuous cooking window fits.",
    "No hay un intervalo continuo para cocinar.",
  ],
} satisfies Record<
  FoodPlan["slots"][number]["holds"][number],
  [string, string]
>;
/** Person-only projection supplied by the caller. Does not fetch, save, consume
 * or persist source data; edited alternatives must go through a fresh preview. */
export function FoodPlanSummary({
  plan: raw,
  mode,
  busy = false,
  onChooseRecipe,
  detailsForChoice,
}: {
  plan: FoodPlan;
  mode: "meals" | "prep";
  busy?: boolean;
  onChooseRecipe?: (slotKey: string, recipeId: string) => void;
  detailsForChoice?: (key: string) => React.ReactNode;
}) {
  const { locale } = useTranslation(),
    es = locale === "es";
  const plan = foodPlanView.parse(raw);
  const [position, setPosition] = React.useState(0);
  const index = Math.min(position, plan.slots.length - 1),
    row = plan.slots[index],
    choice = row.choice;
  const pick = (en: string, spanish: string) => (es ? spanish : en);
  const quantity = (value: number | null, unit: string | null) =>
    value === null
      ? pick("Unknown", "Desconocido")
      : (formatRecipeAmount(value, unit, locale) ??
        pick("Unknown", "Desconocido"));
  return (
    <section
      aria-label={pick("Review food plan", "Revisar plan de comidas")}
      className="space-y-4"
    >
      <p className="text-subhead text-label-secondary">
        {pick(
          "Estimates use recorded household stock and plans. Nothing is reserved or saved yet.",
          "Las estimaciones usan las existencias y los planes registrados del hogar. Aún no se ha reservado ni guardado nada.",
        )}
      </p>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-secondary min-h-[44px] min-w-[44px]"
          disabled={busy || index === 0}
          onClick={() => setPosition(index - 1)}
          aria-label={pick("Previous choice", "Opción anterior")}
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </button>
        <p aria-live="polite" className="text-subhead font-semibold">
          {pick("Choice", "Opción")} {index + 1} / {plan.slots.length}
        </p>
        <button
          type="button"
          className="btn-secondary min-h-[44px] min-w-[44px]"
          disabled={busy || index + 1 === plan.slots.length}
          onClick={() => setPosition(index + 1)}
          aria-label={pick("Next choice", "Opción siguiente")}
        >
          <ChevronRight aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <article
        className="card-apple space-y-3 p-4"
        aria-label={
          choice?.title ?? pick("Unavailable choice", "Opción no disponible")
        }
      >
        <h3 className="text-title3 font-semibold break-words">
          {choice?.title ?? pick("Choose another recipe", "Elige otra receta")}
        </h3>
        {choice && (
          <>
            <p>
              {choice.servings} {pick("servings", "porciones")} ·{" "}
              {choice.totalMinutes === null
                ? pick(
                    "Time for these servings is unknown",
                    "Se desconoce el tiempo para estas porciones",
                  )
                : `${choice.totalMinutes} min`}
            </p>
            {choice.totalMinutes === null &&
              choice.authoredMinutes !== null && (
                <p className="text-subhead text-label-secondary">
                  {pick(
                    "Recorded recipe time",
                    "Tiempo de la receta registrada",
                  )}
                  : {choice.authoredMinutes} min / {choice.baseServings}{" "}
                  {pick(
                    "servings; scaling portions does not establish cooking time.",
                    "porciones; cambiar las porciones no determina el tiempo de cocina.",
                  )}
                </p>
              )}
            {choice.schedule && choice.schedule.state !== "not-requested" && (
              <p className="text-subhead">
                {choice.schedule.state === "fits"
                  ? pick(
                      "Estimated to fit recorded household events.",
                      "Se estima que cabe entre los eventos registrados del hogar.",
                    )
                  : pick(
                      "Cooking-window review required.",
                      "Es necesario revisar el intervalo para cocinar.",
                    )}
                {choice.schedule.departure && (
                  <>
                    {" "}
                    {pick("Departure", "Salida")}:{" "}
                    {choice.schedule.departure.title}.
                  </>
                )}
              </p>
            )}
            <details>
              <summary className="min-h-[44px] cursor-pointer py-3 font-semibold">
                {pick(
                  "Ingredients and recorded stock",
                  "Ingredientes y existencias registradas",
                )}{" "}
                ({choice.ingredients.length})
              </summary>
              <PagedList key={row.key} es={es}>
                {choice.ingredients.map((line) => (
                  <li
                    key={line.ingredientId}
                    className="border-t border-[var(--separator)] pt-3 break-words"
                  >
                    <p className="font-semibold">{line.name}</p>
                    <p className="text-subhead">
                      {pick("Needed", "Necesario")}:{" "}
                      {quantity(line.required, line.unit)} ·{" "}
                      {pick(
                        "Known comparable stock",
                        "Existencias comparables conocidas",
                      )}
                      : {quantity(line.recordedAvailable, line.unit)}
                    </p>
                    <p className="text-subhead text-label-secondary">
                      {line.state === "check"
                        ? pick(
                            "Check quantities or units before relying on this estimate.",
                            "Comprueba las cantidades o unidades antes de confiar en esta estimación.",
                          )
                        : line.state === "shortfall"
                          ? `${pick("Recorded shortfall", "Déficit registrado")}: ${quantity(line.shortfall, line.unit)}`
                          : pick(
                              "Comparable recorded stock covers this estimated amount.",
                              "Las existencias comparables registradas cubren esta cantidad estimada.",
                            )}
                      {line.match === "name" && (
                        <>
                          {" "}
                          {pick(
                            "Matched by name; no ingredient link was created.",
                            "Coincidencia por nombre; no se creó un vínculo con el ingrediente.",
                          )}
                        </>
                      )}
                      {line.useSoon && (
                        <>
                          {" "}
                          {pick(
                            "Uses recorded stock with an upcoming date.",
                            "Usa existencias con una fecha próxima.",
                          )}
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
              {pick(
                "Review needed before saving",
                "Hay que revisar antes de guardar",
              )}
            </p>
            <ul className="list-disc pl-5">
              {row.holds.map((hold) => (
                <li key={hold}>{labels[hold][es ? 1 : 0]}</li>
              ))}
            </ul>
          </div>
        )}
        {detailsForChoice?.(row.key)}
        {onChooseRecipe && row.alternatives.length > 0 && (
          <details>
            <summary className="min-h-[44px] cursor-pointer py-3 font-semibold">
              {pick("Other recipes", "Otras recetas")}
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
          {pick(
            "Sequential prep estimate",
            "Estimación de preparación secuencial",
          )}
          :{" "}
          {plan.prepMinutes === null
            ? pick("Unknown", "Desconocida")
            : `${plan.prepMinutes} min`}
          .{" "}
          {plan.prepTime === "over-requested-limit" &&
            pick(
              "This exceeds your prep-session limit.",
              "Esto supera el límite de la sesión.",
            )}{" "}
          {plan.prepSchedule?.state === "conflict" &&
            pick(
              "The whole session does not fit the selected window.",
              "La sesión completa no cabe en el intervalo elegido.",
            )}
          {plan.prepSchedule?.state === "unknown" &&
            pick(
              "The whole session's calendar fit is unknown.",
              "Se desconoce si la sesión completa cabe en el calendario.",
            )}
        </p>
      )}
      <details>
        <summary className="min-h-[44px] cursor-pointer py-3 font-semibold">
          {pick("Existing meal commitments", "Comidas ya planificadas")} (
          {plan.commitments.entries.length})
        </summary>
        {!plan.existingMealReservationsChecked ? (
          <p>
            {pick(
              "Existing reservations were not checked.",
              "No se comprobaron las reservas existentes.",
            )}
          </p>
        ) : (
          <>
            {!plan.commitments.complete && (
              <p role="status">
                {pick(
                  "Some existing quantities or prep states are unresolved. New stock estimates remain held.",
                  "Algunas cantidades o estados de preparación no están claros. Las nuevas estimaciones quedan pendientes.",
                )}
              </p>
            )}
            <PagedList es={es}>
              {plan.commitments.entries.map((entry) => (
                <li key={entry.id} className="break-words">
                  <p className="font-semibold">
                    {entry.label ??
                      pick(
                        "Unnamed existing meal",
                        "Comida existente sin nombre",
                      )}
                  </p>
                  <p className="text-subhead">
                    {entry.originalDate} ·{" "}
                    {entry.servings !== null &&
                    Number.isInteger(entry.servings) &&
                    entry.servings > 0 &&
                    entry.servings <= 100
                      ? entry.servings
                      : pick("Unknown", "Desconocidas")}{" "}
                    {pick("servings", "porciones")}
                    {entry.servingsBasis === "recipe-default" && (
                      <>
                        {" "}
                        ·{" "}
                        {pick(
                          "recipe default",
                          "cantidad predeterminada de la receta",
                        )}
                      </>
                    )}
                    {entry.holds.length > 0 && (
                      <> · {pick("Needs review", "Necesita revisión")}</>
                    )}
                  </p>
                </li>
              ))}
            </PagedList>
          </>
        )}
      </details>
      {plan.commitments.prepared.length > 0 && (
        <details>
          <summary className="min-h-[44px] cursor-pointer py-3 font-semibold">
            {pick(
              "Recorded prepared portions",
              "Porciones preparadas registradas",
            )}{" "}
            ({plan.commitments.prepared.length})
          </summary>
          <p className="text-subhead text-label-secondary">
            {pick(
              "Dates do not mark food eaten. These records are not a freshness or food-safety guarantee.",
              "Las fechas no marcan la comida como consumida. Estos registros no garantizan frescura ni seguridad alimentaria.",
            )}
          </p>
          <PagedList es={es}>
            {plan.commitments.prepared.map((dish) => (
              <li key={dish.batchId} className="break-words">
                <p className="font-semibold">{dish.name}</p>
                <p className="text-subhead">
                  {dish.eaten} {pick("eaten", "consumidas")} · {dish.planned}{" "}
                  {pick("planned", "planificadas")} · {dish.remaining}{" "}
                  {pick("remaining", "restantes")} · {dish.unplanned}{" "}
                  {pick("unplanned", "sin planificar")}
                </p>
                <p className="text-subhead text-label-secondary">
                  {dish.storage === "freezer"
                    ? pick("Freezer", "Congelador")
                    : pick("Fridge", "Nevera")}{" "}
                  · {pick("Prep day", "Día de preparación")}: {dish.preparedOn}
                  {dish.nextPrepOn && (
                    <>
                      {" "}
                      · {pick("Next prep", "Próxima preparación")}:{" "}
                      {dish.nextPrepOn}
                    </>
                  )}
                </p>
              </li>
            ))}
          </PagedList>
          <Link
            href="/dashboard/meals?view=bulk"
            className="btn-secondary inline-flex min-h-[44px] items-center"
          >
            {pick("Manage prepared portions", "Gestionar porciones preparadas")}
          </Link>
        </details>
      )}
    </section>
  );
}

/** Expandable detail pages stay short even with a full bounded source graph. */
function PagedList({
  children,
  es,
}: {
  children: React.ReactNode[];
  es: boolean;
}) {
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
            {es ? "Anteriores" : "Previous records"}
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
            {es ? "Siguientes" : "Next records"}
          </button>
        </div>
      )}
    </div>
  );
}
