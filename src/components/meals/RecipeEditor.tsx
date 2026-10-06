"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { RecipeOption } from "./RecipePicker";
import type { RecipeDetailData } from "./RecipeDetail";

interface IngredientDraft {
  key: number;
  name: string;
  amount: string;
  unit: string;
  note: string;
  ingredientId?: string;
  originalName?: string;
}

function toMinutes(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > 24 * 60) return "invalid";
  return n;
}

/**
 * Inline "new recipe" panel: title, prep and cook minutes, ingredient lines.
 * Exported for tests.
 */
export function RecipeEditor({
  onCreated,
  onCancel,
  initialRecipe,
  onSaved,
  onSavingChange,
  disabled = false,
  isMutationPending,
}: {
  onCreated?: (recipe: RecipeOption) => void;
  initialRecipe?: RecipeDetailData;
  onSaved?: (recipe: RecipeDetailData) => void;
  onCancel: () => void;
  onSavingChange?: (saving: boolean) => void;
  /** Owning meal save/delete disables this inline editor. */
  disabled?: boolean;
  /** Synchronous owner guard for handlers retained before a render. */
  isMutationPending?: () => boolean;
}) {
  const baseId = React.useId();
  const titleRef = React.useRef<HTMLInputElement>(null);
  const nextKey = React.useRef(initialRecipe?.ingredients.length ?? 1);
  const [title, setTitle] = React.useState(initialRecipe?.title ?? "");
  const [servings, setServings] = React.useState(
    String(initialRecipe?.servings ?? 2),
  );
  const [description, setDescription] = React.useState(
    initialRecipe?.description ?? "",
  );
  const [instructions, setInstructions] = React.useState(
    initialRecipe?.instructions ?? "",
  );
  const [prep, setPrep] = React.useState(
    initialRecipe?.prep_time == null ? "" : String(initialRecipe.prep_time),
  );
  const [cook, setCook] = React.useState(
    initialRecipe?.cook_time == null ? "" : String(initialRecipe.cook_time),
  );
  const [lines, setLines] = React.useState<IngredientDraft[]>(() =>
    initialRecipe
      ? initialRecipe.ingredients.map((line, key) => ({
          key,
          name: line.ingredient.name,
          amount: String(line.amount),
          unit: line.unit ?? "",
          note: line.note ?? "",
          ingredientId: line.ingredient.id,
          originalName: line.ingredient.name,
        }))
      : [{ key: 0, name: "", amount: "1", unit: "", note: "" }],
  );
  const originalLines = React.useRef(lines);
  const [saving, setSaving] = React.useState(false);
  const mutationPending = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [uncertain, setUncertain] = React.useState(false);
  const uncertainRef = React.useRef(false);
  const uncertainMessage =
    "The recipe may have been saved, but we couldn’t confirm it. Close this editor and reload recipes to check before creating or saving again.";
  const markUncertain = () => {
    uncertainRef.current = true;
    setUncertain(true);
    setError(uncertainMessage);
  };

  React.useEffect(() => {
    if (!initialRecipe) titleRef.current?.focus();
    // Editing is focused by the owning Dialog so its return target is preserved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateLine = (key: number, patch: Partial<IngredientDraft>) =>
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      { key: nextKey.current++, name: "", amount: "1", unit: "", note: "" },
    ]);

  const removeLine = (key: number) =>
    setLines((prev) => prev.filter((l) => l.key !== key));

  const submit = async () => {
    if (
      disabled ||
      isMutationPending?.() ||
      mutationPending.current ||
      saving ||
      uncertainRef.current
    )
      return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Give the recipe a name.");
      titleRef.current?.focus();
      return;
    }
    const baseServings = Number(servings);
    if (
      !servings.trim() ||
      !Number.isInteger(baseServings) ||
      baseServings < 1 ||
      baseServings > 100
    ) {
      setError("Base servings must be a whole number from 1 to 100.");
      return;
    }
    const prepMinutes = toMinutes(prep);
    const cookMinutes = toMinutes(cook);
    if (prepMinutes === "invalid" || cookMinutes === "invalid") {
      setError("Times must be whole minutes, up to 1440.");
      return;
    }
    const ingredients: {
      name?: string;
      ingredient_id?: string;
      amount: number;
      unit?: string | null;
      note?: string | null;
    }[] = [];
    for (const line of lines) {
      const name = line.name.trim();
      if (!name) {
        if (line.ingredientId) {
          setError(
            "Keep an ingredient name, or use Remove ingredient to remove the line.",
          );
          return;
        }
        continue;
      }
      const amount = Number(line.amount.trim());
      if (
        !line.amount.trim() ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > 100000
      ) {
        setError(`Amount for “${name}” must be a number from 0 to 100000.`);
        return;
      }
      const unit = line.unit.trim();
      ingredients.push(
        initialRecipe
          ? {
              ...(line.ingredientId &&
              name.normalize("NFC").replace(/\s+/g, " ").toLowerCase() ===
                line.originalName
                  ?.normalize("NFC")
                  .trim()
                  .replace(/\s+/g, " ")
                  .toLowerCase()
                ? { ingredient_id: line.ingredientId }
                : { name }),
              amount,
              unit: unit || null,
              note: line.note.trim() || null,
            }
          : {
              name,
              amount,
              ...(unit ? { unit } : {}),
              ...(line.note.trim() ? { note: line.note.trim() } : {}),
            },
      );
    }

    if (ingredients.length > 100) {
      setError("A recipe can have at most 100 ingredients.");
      return;
    }
    mutationPending.current = true;
    setSaving(true);
    try {
      onSavingChange?.(true);
      setError(null);
      const fields = {
        title: cleanTitle,
        servings: Number(servings),
        description: description.trim() || null,
        instructions: instructions.trim() || null,
        prep_time: prepMinutes,
        cook_time: cookMinutes,
      };
      const drafts = {
        title,
        servings,
        description,
        instructions,
        prep_time: prep,
        cook_time: cook,
      };
      const originalDrafts = initialRecipe
        ? {
            title: initialRecipe.title,
            servings: String(initialRecipe.servings ?? 2),
            description: initialRecipe.description ?? "",
            instructions: initialRecipe.instructions ?? "",
            prep_time:
              initialRecipe.prep_time == null
                ? ""
                : String(initialRecipe.prep_time),
            cook_time:
              initialRecipe.cook_time == null
                ? ""
                : String(initialRecipe.cook_time),
          }
        : null;
      const body: Record<string, unknown> = originalDrafts
        ? Object.fromEntries(
            Object.entries(fields).filter(
              ([key]) =>
                drafts[key as keyof typeof drafts] !==
                originalDrafts[key as keyof typeof drafts],
            ),
          )
        : {
            title: cleanTitle,
            servings: Number(servings),
            ...(fields.description ? { description: fields.description } : {}),
            ...(fields.instructions
              ? { instructions: fields.instructions }
              : {}),
            ...(prepMinutes !== null ? { prep_time: prepMinutes } : {}),
            ...(cookMinutes !== null ? { cook_time: cookMinutes } : {}),
            ...(ingredients.length > 0 ? { ingredients } : {}),
          };
      // Preserve untouched join rows (and legacy notes) by omitting the replacement field.
      if (
        initialRecipe &&
        JSON.stringify(lines) !== JSON.stringify(originalLines.current)
      )
        body.ingredients = ingredients;
      if (initialRecipe && Object.keys(body).length === 0) {
        onSaved?.(initialRecipe);
        return;
      }
      const res = await fetch(
        initialRecipe
          ? `/api/recipes/${encodeURIComponent(initialRecipe.id)}`
          : "/api/recipes",
        {
          method: initialRecipe ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        recipe?: RecipeDetailData;
        error?: unknown;
      } | null;
      if (!res.ok) {
        if (res.status >= 500) markUncertain();
        else
          setError(
            typeof data?.error === "string"
              ? data.error
              : "The recipe was not accepted. Check your entries and permissions.",
          );
        return;
      }
      if (
        !data?.recipe ||
        typeof data.recipe.id !== "string" ||
        !data.recipe.id ||
        typeof data.recipe.title !== "string"
      ) {
        markUncertain();
        return;
      }
      const r = data.recipe;
      if (
        initialRecipe &&
        (r.id !== initialRecipe.id ||
          !Array.isArray(r.ingredients) ||
          r.ingredients.some(
            (line) =>
              !line?.ingredient || typeof line.ingredient.name !== "string",
          ) ||
          [
            "description",
            "instructions",
            "prep_time",
            "cook_time",
            "servings",
          ].some((field) => !(field in r)))
      ) {
        markUncertain();
        return;
      }
      if (initialRecipe) onSaved?.(r);
      else
        onCreated?.({
          id: r.id,
          title: r.title,
          prep_time: r.prep_time,
          cook_time: r.cook_time,
          servings: r.servings,
        });
    } catch {
      markUncertain();
    } finally {
      mutationPending.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  };

  // Enter in a field creates the recipe instead of submitting the meal form.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!initialRecipe) void submit();
    }
  };

  return (
    <fieldset
      className="space-y-3 rounded-xl border border-[var(--surface-separator)] p-3"
      data-testid="recipe-quick-create"
      disabled={saving || disabled}
    >
      <legend className="px-1 text-subhead font-semibold text-label-primary">
        {initialRecipe ? "Recipe details" : "New recipe"}
      </legend>

      <div>
        <label
          htmlFor={`${baseId}-title`}
          className="text-subhead text-label-secondary mb-1 block"
        >
          Recipe name
        </label>
        <input
          ref={titleRef}
          id={`${baseId}-title`}
          type="text"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full input-apple min-h-[44px]"
        />
      </div>

      <div>
        <label
          htmlFor={`${baseId}-servings`}
          className="text-subhead text-label-secondary mb-1 block"
        >
          Base servings
        </label>
        <input
          id={`${baseId}-servings`}
          type="number"
          min={1}
          max={100}
          step={1}
          value={servings}
          onChange={(e) => setServings(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full input-apple min-h-[44px]"
        />
        <p className="text-footnote text-label-secondary">
          The ingredient amounts below make this many servings (1–100). Grocery
          requests have a separate 1–50 limit.
        </p>
      </div>
      <div>
        <label
          htmlFor={`${baseId}-description`}
          className="text-subhead text-label-secondary mb-1 block"
        >
          Description
        </label>
        <textarea
          id={`${baseId}-description`}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full input-apple min-h-[88px]"
        />
      </div>
      <div>
        <label
          htmlFor={`${baseId}-instructions`}
          className="text-subhead text-label-secondary mb-1 block"
        >
          Method
        </label>
        <textarea
          id={`${baseId}-instructions`}
          maxLength={20000}
          rows={5}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="w-full input-apple min-h-[88px]"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor={`${baseId}-prep`}
            className="text-subhead text-label-secondary mb-1 block"
          >
            Prep (min)
          </label>
          <input
            id={`${baseId}-prep`}
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            value={prep}
            onChange={(e) => setPrep(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full input-apple min-h-[44px]"
          />
        </div>
        <div>
          <label
            htmlFor={`${baseId}-cook`}
            className="text-subhead text-label-secondary mb-1 block"
          >
            Cook (min)
          </label>
          <input
            id={`${baseId}-cook`}
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            value={cook}
            onChange={(e) => setCook(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full input-apple min-h-[44px]"
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-subhead text-label-secondary">
          Ingredients (optional)
        </p>
        <p className="text-footnote text-label-secondary">
          Saved ingredients are displayed by name. Line entry order is not
          saved.
        </p>
        {lines.map((line, i) => (
          <div
            key={line.key}
            role="group"
            aria-label={`Ingredient ${i + 1}`}
            className="flex flex-wrap items-end gap-2"
          >
            <div className="w-16 shrink-0">
              <label
                htmlFor={`${baseId}-amt-${line.key}`}
                className="text-caption-1 text-label-secondary block"
              >
                Amount
              </label>
              <input
                id={`${baseId}-amt-${line.key}`}
                type="text"
                inputMode="decimal"
                value={line.amount}
                onChange={(e) =>
                  updateLine(line.key, { amount: e.target.value })
                }
                onKeyDown={onKeyDown}
                className="w-full input-apple min-h-[44px]"
              />
            </div>
            <div className="w-16 shrink-0">
              <label
                htmlFor={`${baseId}-unit-${line.key}`}
                className="text-caption-1 text-label-secondary block"
              >
                Unit
              </label>
              <input
                id={`${baseId}-unit-${line.key}`}
                type="text"
                maxLength={32}
                value={line.unit}
                onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                onKeyDown={onKeyDown}
                className="w-full input-apple min-h-[44px]"
              />
            </div>
            <div className="min-w-0 flex-1">
              <label
                htmlFor={`${baseId}-name-${line.key}`}
                className="text-caption-1 text-label-secondary block"
              >
                Ingredient
              </label>
              <input
                id={`${baseId}-name-${line.key}`}
                type="text"
                maxLength={200}
                value={line.name}
                onChange={(e) => updateLine(line.key, { name: e.target.value })}
                onKeyDown={onKeyDown}
                className="w-full input-apple min-h-[44px]"
              />
            </div>
            <div className="w-full">
              <label
                htmlFor={`${baseId}-note-${line.key}`}
                className="text-caption-1 text-label-secondary block"
              >
                Ingredient note
              </label>
              <input
                id={`${baseId}-note-${line.key}`}
                type="text"
                maxLength={200}
                value={line.note}
                onChange={(e) => updateLine(line.key, { note: e.target.value })}
                onKeyDown={onKeyDown}
                className="w-full input-apple min-h-[44px]"
              />
            </div>
            <button
              type="button"
              onClick={() => removeLine(line.key)}
              aria-label={`Remove ingredient ${i + 1}`}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-label-secondary active:bg-[var(--surface-fill)]"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addLine}
          className="inline-flex min-h-[44px] items-center gap-1 px-1 text-subhead text-[var(--accent-text)]"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Add ingredient
        </button>
      </div>

      {error && (
        <p role="alert" className="text-footnote text-[var(--danger-text)]">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            if (mutationPending.current || disabled || isMutationPending?.())
              return;
            onCancel();
          }}
          className="btn-plain flex-1 min-h-[44px]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={uncertain}
          onClick={() => void submit()}
          className="btn-tinted flex-1 min-h-[44px]"
        >
          {saving ? "Saving…" : "Save recipe"}
        </button>
      </div>
    </fieldset>
  );
}
