/** One explicit free-text planned meal; never chooses a cook/recipe ID or marks food eaten. */
import { parseDateOnly } from "@/lib/dates";
export type MealDescriptionDraft = {
  recipe_name: string;
  date?: string;
  meal_type?: "breakfast" | "lunch" | "dinner" | "snack";
  servings?: number;
};
export type MealDescriptionResult =
  | { kind: "review"; draft: MealDescriptionDraft }
  | { kind: "manual"; reason: "empty" | "multiple" | "ambiguous" | "too_long" };
const slots: Record<string, MealDescriptionDraft["meal_type"]> = {
  breakfast: "breakfast",
  lunch: "lunch",
  dinner: "dinner",
  snack: "snack",
  desayuno: "breakfast",
  almuerzo: "lunch",
  comida: "lunch",
  cena: "dinner",
  merienda: "snack",
};
export function describeMeal(input: string): MealDescriptionResult {
  if (input.length > 2000) return { kind: "manual", reason: "too_long" };
  let text = input.normalize("NFC").trim();
  if (!text) return { kind: "manual", reason: "empty" };
  if (/[\n;]/u.test(text)) return { kind: "manual", reason: "multiple" };
  text = text
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:plan|add|schedule|planifica|añade|programa)\s+/iu, "");
  if (
    /^(?:(?:I|we)\s+)?(?:ate|eaten|cooked|finished)\b|^(?:comí|comimos|cociné|preparé)(?=\s|$)/iu.test(
      text,
    )
  )
    return { kind: "manual", reason: "ambiguous" };
  const draft: MealDescriptionDraft = { recipe_name: "" };
  const dates = [
    ...text.matchAll(/\b(?:on|el|para el)\s+(\d{4}-\d{2}-\d{2})\b/giu),
  ];
  if (dates.length > 1) return { kind: "manual", reason: "multiple" };
  if (dates.length) {
    if (!parseDateOnly(dates[0][1]))
      return { kind: "manual", reason: "ambiguous" };
    draft.date = dates[0][1];
    text = text.replace(dates[0][0], "").trim();
  }
  if (
    /\d{4}-\d{2}-\d{2}|\b(?:tomorrow|today|tonight|yesterday|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mañana|hoy|anoche|ayer|próxim[oa]|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b/iu.test(
      text,
    )
  )
    return { kind: "manual", reason: "ambiguous" };
  if (
    /\d{1,4}[/-]\d{1,2}|\b(?:on|el)\s+(?:\d+|january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b|\b(?:at|a las?)\s+\d/iu.test(
      text,
    )
  )
    return { kind: "manual", reason: "ambiguous" };
  const servings = [
    ...text.matchAll(
      /\b(?:for|para)\s+(\d+)\s+(?:people|persons|servings|personas|porciones|raciones)\b/giu,
    ),
  ];
  if (servings.length > 1) return { kind: "manual", reason: "ambiguous" };
  if (servings.length) {
    const count = Number(servings[0][1]);
    if (count < 1 || count > 100)
      return { kind: "manual", reason: "ambiguous" };
    draft.servings = count;
    text = text.replace(servings[0][0], "").trim();
  }
  const mealMatches = [
    ...text.matchAll(
      /\b(?:for|para)(?: la| el)?\s+(breakfast|lunch|dinner|snack|desayuno|almuerzo|comida|cena|merienda)\b/giu,
    ),
  ];
  const prefix = text.match(
    /^(breakfast|lunch|dinner|snack|desayuno|almuerzo|comida|cena|merienda):\s*/iu,
  );
  if (mealMatches.length + (prefix ? 1 : 0) > 1)
    return { kind: "manual", reason: "multiple" };
  if (mealMatches.length) {
    draft.meal_type = slots[mealMatches[0][1].toLowerCase()];
    text = text.replace(mealMatches[0][0], "").trim();
  } else if (prefix) {
    draft.meal_type = slots[prefix[1].toLowerCase()];
    text = text.slice(prefix[0].length).trim();
  }
  if (
    /\b(?:for|para)\s+(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)/iu.test(
      text,
    )
  )
    return { kind: "manual", reason: "ambiguous" };
  text = text.trim().replace(/\s+/g, " ");
  if (!text || text.length > 200)
    return { kind: "manual", reason: text.length > 200 ? "too_long" : "empty" };
  draft.recipe_name = text;
  return { kind: "review", draft };
}
