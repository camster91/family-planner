/** Conservative foreground text/voice suggestion, never stock or a freshness claim. */
import { parseDateOnly } from "@/lib/dates";
export type FoodDescriptionDraft = {
  name: string;
  amount?: number;
  unit?: string;
  location?: "fridge" | "freezer" | "pantry";
  expires_on?: string;
  date_kind?: "best_before" | "use_by";
};
export type FoodDescriptionResult =
  | { kind: "review"; draft: FoodDescriptionDraft }
  | { kind: "manual"; reason: "empty" | "multiple" | "ambiguous" | "too_long" };
const locations: Record<string, FoodDescriptionDraft["location"]> = {
  fridge: "fridge",
  refrigerator: "fridge",
  freezer: "freezer",
  pantry: "pantry",
  nevera: "fridge",
  frigorífico: "fridge",
  refrigerador: "fridge",
  congelador: "freezer",
  despensa: "pantry",
};
const englishCounts: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const spanishCounts: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};
const units = new Set([
  "can",
  "cans",
  "carton",
  "cartons",
  "bottle",
  "bottles",
  "bag",
  "bags",
  "box",
  "boxes",
  "jar",
  "jars",
  "pack",
  "packs",
  "package",
  "packages",
  "item",
  "items",
  "kg",
  "g",
  "l",
  "ml",
  "oz",
  "lb",
  "lbs",
  "pound",
  "pounds",
  "lata",
  "latas",
  "botella",
  "botellas",
  "bolsa",
  "bolsas",
  "caja",
  "cajas",
  "tarro",
  "tarros",
  "paquete",
  "paquetes",
  "unidad",
  "unidades",
  "kilo",
  "kilos",
  "gramo",
  "gramos",
  "litro",
  "litros",
  "mililitros",
]);
export function describeFood(
  input: string,
  language: "en" | "es" = "en",
): FoodDescriptionResult {
  const counts = language === "es" ? spanishCounts : englishCounts;
  if (input.length > 2000) return { kind: "manual", reason: "too_long" };
  let text = input.normalize("NFC").trim();
  if (!text) return { kind: "manual", reason: "empty" };
  if (/[\n;,]/.test(text) || /\b(?:and|y)\b/iu.test(text))
    return { kind: "manual", reason: "multiple" };
  text = text.replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  text = text.replace(
    /^(?:add|stock|put|we have|añade|añadir|agrega|agregar|tenemos|tengo|pon)\s+/iu,
    "",
  );
  const draft: FoodDescriptionDraft = { name: "" };
  const dates = [
    ...text.matchAll(
      /\b(best before|use by|consumir preferentemente antes de(?:l)?|fecha de caducidad|caduca(?: el)?)\s+(\d{4}-\d{2}-\d{2})\b/giu,
    ),
  ];
  if (dates.length > 1) return { kind: "manual", reason: "ambiguous" };
  if (dates.length) {
    const match = dates[0];
    if (!parseDateOnly(match[2]))
      return { kind: "manual", reason: "ambiguous" };
    draft.expires_on = match[2];
    draft.date_kind = /^(?:best before|consumir)/iu.test(match[1])
      ? "best_before"
      : "use_by";
    text = text.replace(match[0], "").trim();
  }
  if (
    /\b(?:best before|use by|expiry|expires|caduca|caducidad|preferentemente|tomorrow|today|next|mañana|hoy|próxim[oa]|half|some|several|couple|mitad|varios|varias)\b/iu.test(
      text,
    ) ||
    /\d{4}-\d{2}-\d{2}/u.test(text)
  )
    return { kind: "manual", reason: "ambiguous" };
  const storage = text.match(
    /\s+(?:(?:in|into|to)(?: the)?|(?:en|a)(?: la| el)?)\s+(fridge|refrigerator|freezer|pantry|nevera|frigorífico|refrigerador|congelador|despensa)$/iu,
  );
  if (storage) {
    draft.location = locations[storage[1].toLocaleLowerCase("en-US")];
    text = text.slice(0, storage.index).trim();
  }
  const first = text.match(/^(\S+)\s+(.+)$/u);
  const firstWord = (first?.[1] ?? text).toLocaleLowerCase("en-US");
  if (
    /^(?:thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|trece|catorce|quince|dieciséis|dieciseis|diecisiete|dieciocho|diecinueve|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|mil|medio|media|unos|unas)$/u.test(
      firstWord,
    )
  )
    return { kind: "manual", reason: "ambiguous" };
  if (
    !first &&
    (/^[\d+\-./]/u.test(text) ||
      counts[text.toLocaleLowerCase("en-US")] !== undefined)
  )
    return { kind: "manual", reason: "ambiguous" };
  if (first) {
    const numeric = /^\d+(?:\.\d+)?$/u.test(first[1]);
    const amount = numeric
      ? Number(first[1])
      : counts[first[1].toLocaleLowerCase("en-US")];
    if (amount !== undefined) {
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000)
        return { kind: "manual", reason: "ambiguous" };
      draft.amount = amount;
      text = first[2];
      const unit = text.match(/^(\S+)(?:\s+(.+))?$/u);
      if (unit && units.has(unit[1].toLocaleLowerCase("en-US"))) {
        if (!unit[2]) return { kind: "manual", reason: "ambiguous" };
        draft.unit = unit[1];
        text = unit[2].replace(/^(?:of|de)\s+/iu, "");
      }
    } else if (/^[\d+\-./]/u.test(first[1]))
      return { kind: "manual", reason: "ambiguous" };
  }
  text = text.trim().replace(/\s+/g, " ");
  if (!text || text.length > 200)
    return { kind: "manual", reason: text.length > 200 ? "too_long" : "empty" };
  draft.name = text;
  return { kind: "review", draft };
}
