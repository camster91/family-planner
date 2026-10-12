"use client";
import * as React from "react";
import { z } from "zod";
import { Dialog } from "@/components/ui/dialog";
import {
  RecipePicker,
  type RecipeOption,
} from "@/components/meals/RecipePicker";
import {
  createMealPrepSchema,
  type MealPrepContext,
  type MealPrepSummary,
} from "@/lib/meal-batches";
import { useBulkCookingText } from "@/i18n/bulk-cooking";
import { toDateOnlyUTC } from "@/lib/dates";
import { useMealPrepMutation } from "./use-meal-prep-mutation";
import {
  MealAllocationEditor,
  type AllocationDraft,
} from "./MealAllocationEditor";

type DishDraft = {
  name: string;
  portions: string;
  recipe: RecipeOption | null;
  cookId: string;
  storage: "fridge" | "freezer";
  meals: AllocationDraft[];
};
const emptyDish = (): DishDraft => ({
  name: "",
  portions: "8",
  recipe: null,
  cookId: "",
  storage: "freezer",
  meals: [],
});
export function MealPrepEditor({
  defaultDay,
  seed,
  context,
  onClose,
  onSaved,
}: {
  defaultDay: string;
  context: MealPrepContext;
  seed?: MealPrepSummary;
  onClose: () => void;
  onSaved: (sessionId?: string) => void;
}) {
  const tBulk = useBulkCookingText();
  const origin = React.useRef(context);
  const [day, setDay] = React.useState(defaultDay);
  const [nextDay, setNextDay] = React.useState("");
  const [dishes, setDishes] = React.useState<DishDraft[]>(() =>
    seed
      ? seed.batches.map((batch) => ({
          name: batch.name,
          portions: String(batch.total_servings),
          recipe: batch.recipe_id
            ? {
                id: batch.recipe_id,
                title: batch.name,
                servings: batch.total_servings,
                prep_time: null,
                cook_time: null,
              }
            : null,
          cookId: batch.cook_id ?? "",
          storage: batch.reserve_storage,
          meals: [],
        }))
      : [emptyDish()],
  );
  const initial = React.useRef(
    JSON.stringify({ day: defaultDay, nextDay: "", dishes }),
  );
  const dirty = JSON.stringify({ day, nextDay, dishes }) !== initial.current;
  const [step, setStep] = React.useState(0);
  const [selectedDish, setSelectedDish] = React.useState(0);
  const [discard, setDiscard] = React.useState(false);
  const [validation, setValidation] = React.useState(false);
  const [members, setMembers] = React.useState<{ id: string; name: string }[]>(
    [],
  );
  const [membersError, setMembersError] = React.useState(false);
  const prefix = React.useId();
  const form = React.useRef<HTMLFormElement>(null);
  const mutation = useMealPrepMutation((receipt) =>
    onSaved("sessionId" in receipt ? receipt.sessionId : undefined),
  );
  React.useEffect(() => {
    let active = true;
    fetch("/api/family/members", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Cooks unavailable");
        const parsed = z
          .object({
            members: z
              .array(z.object({ id: z.string(), name: z.string() }))
              .max(500),
          })
          .parse(await res.json());
        if (active) setMembers(parsed.members);
      })
      .catch(() => {
        if (active) setMembersError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  React.useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const update = (change: Partial<DishDraft>) => {
    setDishes((prev) =>
      prev.map((dish, i) =>
        i === selectedDish ? { ...dish, ...change } : dish,
      ),
    );
    setValidation(false);
    mutation.clearError();
  };
  const requestClose = () => {
    if (mutation.isPending()) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  const payload = () => ({
    expected_family_id: origin.current.familyId,
    expected_user_id: origin.current.userId,
    prepared_on: day,
    next_prep_on: nextDay || null,
    dishes: dishes.map((dish) => ({
      name: dish.name,
      total_servings: Number(dish.portions),
      recipe_id: dish.recipe?.id ?? null,
      cook_id: dish.cookId || null,
      reserve_storage: dish.storage,
      meals: dish.meals.map((meal) => ({
        ...meal,
        servings: Number(meal.servings),
      })),
    })),
  });
  const dish = dishes[selectedDish];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending()) return;
    if (step < 2) { advance(); return; }
    const parsed = createMealPrepSchema.safeParse(payload());
    if (!parsed.success) {
      setValidation(true);
      return;
    }
    void mutation.save(parsed.data, "/api/meals/bulk");
  };
  const advance = () => {
    if (!form.current?.reportValidity()) return;
    if (
      step === 1 &&
      dishes.some(
        (dish) =>
          !dish.name.trim() ||
          !Number.isInteger(Number(dish.portions)) ||
          Number(dish.portions) < 1 ||
          Number(dish.portions) > 50,
      )
    ) {
      setValidation(true);
      return;
    }
    setValidation(false);
    setStep(step + 1);
  };
  return (
    <>
      <Dialog
        open
        variant="form"
        title={tBulk("add")}
        onClose={mutation.locked ? undefined : requestClose}
        closeLabel={tBulk("close")}
        className="sm:max-w-xl"
        testId="meal-prep-editor"
      >
        <form ref={form} onSubmit={submit} className="space-y-4">
          <ol
            className="flex flex-wrap gap-2 text-footnote"
            aria-label={tBulk("add")}
          >
            {(["stepPrep", "stepDishes", "stepMeals"] as const).map(
              (key, index) => (
                <li
                  key={key}
                  aria-current={step === index ? "step" : undefined}
                  className={
                    step === index
                      ? "font-semibold text-label-primary"
                      : "text-label-secondary"
                  }
                >
                  {index + 1}. {tBulk(key)}
                </li>
              ),
            )}
          </ol>
          {step === 0 && (
            <>
              <label htmlFor={`${prefix}-day`} className="block text-subhead">
                {tBulk("date")}
                <input
                  className="input-field w-full mt-1"
                  id={`${prefix}-day`}
                  type="date"
                  required
                  value={day}
                  disabled={mutation.locked}
                  onChange={(e) => setDay(e.target.value)}
                />
              </label>
              <label htmlFor={`${prefix}-next`} className="block text-subhead">
                {tBulk("nextDate")}
                <input
                  className="input-field w-full mt-1"
                  id={`${prefix}-next`}
                  type="date"
                  min={day}
                  value={nextDay}
                  disabled={mutation.locked}
                  onChange={(e) => setNextDay(e.target.value)}
                />
              </label>
            </>
          )}
          {step > 0 && (
            <>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={tBulk("stepDishes")}
              >
                {dishes.map((row, index) => (
                  <button
                    type="button"
                    key={index}
                    disabled={mutation.locked}
                    aria-pressed={index === selectedDish}
                    aria-label={tBulk("selectDish", {
                      name:
                        row.name || tBulk("dishNumber", { number: index + 1 }),
                    })}
                    className="btn-tinted min-h-[44px] max-w-full break-words"
                    onClick={() => setSelectedDish(index)}
                  >
                    {row.name || tBulk("dishNumber", { number: index + 1 })}
                  </button>
                ))}
              </div>
              {step === 1 ? (
                <>
                  <RecipePicker
                    value={dish.recipe?.id ?? null}
                    canCreate={false}
                    initialRecipe={dish.recipe}
                    disabled={mutation.locked}
                    onChange={(recipe) =>
                      update({
                        recipe,
                        ...(recipe &&
                        (!dish.name || dish.name === dish.recipe?.title)
                          ? { name: recipe.title }
                          : {}),
                      })
                    }
                  />
                  <label
                    className="block text-subhead"
                    htmlFor={`${prefix}-name`}
                  >
                    {tBulk("name")}
                    <input
                      id={`${prefix}-name`}
                      className="input-field w-full mt-1"
                      required
                      maxLength={200}
                      value={dish.name}
                      placeholder={tBulk("namePlaceholder")}
                      disabled={mutation.locked}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </label>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label
                      className="text-subhead"
                      htmlFor={`${prefix}-portions`}
                    >
                      {tBulk("portions")}
                      <input
                        id={`${prefix}-portions`}
                        className="input-field w-full mt-1"
                        type="number"
                        min={1}
                        max={50}
                        step={1}
                        required
                        value={dish.portions}
                        disabled={mutation.locked}
                        onChange={(e) => update({ portions: e.target.value })}
                      />
                    </label>
                    <label className="text-subhead" htmlFor={`${prefix}-cook`}>
                      {tBulk("cook")}
                      <select
                        id={`${prefix}-cook`}
                        className="input-field w-full mt-1"
                        value={dish.cookId}
                        disabled={mutation.locked || membersError}
                        onChange={(e) => update({ cookId: e.target.value })}
                      >
                        <option value="">{tBulk("anyone")}</option>
                        {dish.cookId &&
                          !members.some(
                            (member) => member.id === dish.cookId,
                          ) && (
                            <option value={dish.cookId}>
                              {tBulk("cookError")}
                            </option>
                          )}
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {membersError && (
                    <div className="text-subhead text-label-secondary">
                      <p>{tBulk("membersError")}</p>
                      {dish.cookId && (
                        <button
                          type="button"
                          className="btn-tinted min-h-[44px]"
                          disabled={mutation.locked}
                          onClick={() => update({ cookId: "" })}
                        >
                          {tBulk("anyone")}
                        </button>
                      )}
                    </div>
                  )}
                  <label
                    className="block text-subhead"
                    htmlFor={`${prefix}-storage`}
                  >
                    {tBulk("storage")}
                    <select
                      id={`${prefix}-storage`}
                      className="input-field w-full mt-1"
                      value={dish.storage}
                      disabled={mutation.locked}
                      onChange={(e) =>
                        update({
                          storage: e.target.value as "fridge" | "freezer",
                        })
                      }
                    >
                      <option value="fridge">{tBulk("fridge")}</option>
                      <option value="freezer">{tBulk("freezer")}</option>
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-tinted min-h-[44px]"
                      disabled={mutation.locked || dishes.length >= 8}
                      onClick={() => {
                        if (!form.current?.reportValidity()) return;
                        setDishes([...dishes, emptyDish()]);
                        setSelectedDish(dishes.length);
                      }}
                    >
                      {tBulk("addDish")}
                    </button>
                    <button
                      type="button"
                      className="btn-tinted min-h-[44px]"
                      disabled={mutation.locked || dishes.length === 1}
                      onClick={() => {
                        setDishes(
                          dishes.filter((_, index) => index !== selectedDish),
                        );
                        setSelectedDish(Math.max(0, selectedDish - 1));
                      }}
                    >
                      {tBulk("removeDish")}
                    </button>
                  </div>
                  <p className="text-footnote text-label-secondary">
                    {tBulk("limit")}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-headline break-words">{dish.name}</h3>
                  <MealAllocationEditor
                    meals={dish.meals}
                    preparationDay={day}
                    available={Number(dish.portions)}
                    disabled={mutation.locked}
                    onChange={(meals) => update({ meals })}
                  />
                  <ul className="space-y-2 rounded-xl bg-[var(--surface-fill)] p-3">
                    {dishes.map((row, index) => (
                      <li key={index} className="text-subhead break-words">
                        <strong>{row.name}</strong> ·{" "}
                        {tBulk("total", { count: row.portions })} ·{" "}
                        {tBulk("planned", {
                          count: row.meals.reduce(
                            (n, meal) => n + Number(meal.servings),
                            0,
                          ),
                        })}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {(validation || mutation.error) && (
            <p role="alert" className="text-subhead text-[var(--danger-text)]">
              {mutation.error ?? tBulk("invalid")}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            {step > 0 && (
              <button
                type="button"
                className="btn-tinted min-h-[44px]"
                disabled={mutation.locked}
                onClick={() => setStep(step - 1)}
              >
                {tBulk("back")}
              </button>
            )}
            {mutation.unknown ? (
              <button
                type="button"
                className="btn-filled min-h-[44px]"
                disabled={mutation.busy}
                onClick={() => void mutation.retry()}
              >
                {mutation.busy ? tBulk("saving") : tBulk("retry")}
              </button>
            ) : step < 2 ? (
              <button
                type="button"
                className="btn-filled min-h-[44px]"
                key="advance-prep-step"
                onClick={(event) => {
                  event.preventDefault();
                  advance();
                }}
              >
                {tBulk("next")}
              </button>
            ) : (
              <button
                key="save-prep-session"
                type="submit"
                className="btn-filled min-h-[44px]"
                disabled={mutation.busy}
              >
                {mutation.busy ? tBulk("saving") : tBulk("save")}
              </button>
            )}
            <button
              type="button"
              className="btn-tinted min-h-[44px]"
              disabled={mutation.locked}
              onClick={requestClose}
            >
              {tBulk("cancel")}
            </button>
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
