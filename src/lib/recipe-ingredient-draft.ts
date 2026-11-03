/** Conservative import suggestions, reviewed before save. Never invent a quantity. */
export function recipeIngredientDraft(raw: string) {
  const line = raw.trim();
  const fallback = { name: line, amount: "", unit: "", note: "" };
  // Accept explicit decimal/simple/mixed fractions only. Ranges, package sizes,
  // Unicode fractions and descriptive quantities stay verbatim for review.
  const match = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s+(.+)$/.exec(line);
  if (!match || /^(?:[-–—\d/]|[x×]\s*\d|to\s+\d)/i.test(match[2])) return fallback;
  const parts = match[1].split(/\s+/);
  const quantity = parts.reduce((sum, part) => {
    const [numerator, denominator] = part.split("/").map(Number);
    return (
      sum + (denominator === undefined ? numerator : numerator / denominator)
    );
  }, 0);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000)
    return fallback;
  const unitMatch =
    /^(g|kg|mg|ml|l|oz|lb|lbs|tsp|tbsp|teaspoons?|tablespoons?|cups?|grams?|kilograms?|millilitres?|milliliters?|litres?|liters?|ounces?|pounds?)\.?\s+(.+)$/i.exec(
      match[2],
    );
  return {
    name: unitMatch ? unitMatch[2] : match[2],
    amount: String(quantity),
    unit: unitMatch ? unitMatch[1].toLowerCase() : "",
    note: "",
  };
}
