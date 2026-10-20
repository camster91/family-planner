/** Read-only arithmetic on reviewed numeric quantities; never parse or convert authored text/units. */
export function scaleRecipeAmount(
  amount: number,
  base: number,
  target: number,
): number | null {
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isInteger(base) ||
    base < 1 ||
    base > 100 ||
    !Number.isInteger(target) ||
    target < 1 ||
    target > 100
  )
    return null;
  const scaled = (amount * target) / base;
  return Number.isFinite(scaled) ? scaled : null;
}
export function formatRecipeAmount(
  amount: number,
  unit: string | null,
  locale = "en",
): string | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const value = new Intl.NumberFormat(locale, {
    maximumSignificantDigits: 4,
  }).format(amount);
  return unit?.trim() ? `${value} ${unit.trim()}` : value;
}
