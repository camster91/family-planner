/**
 * One money formatter for everyday screens (allowance, wishlist, budget).
 *
 * There is no household currency setting yet, so every amount keeps the
 * existing canonical USD denomination; the locale only controls how it is
 * written ("$10.00" in English, "10,00 US$" in Spanish). When a household
 * currency setting exists, pass it as `currency`.
 */
export const DEFAULT_CURRENCY = "USD";

export function formatMoney(
  amount: number,
  locale: string,
  currency: string = DEFAULT_CURRENCY,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * A typed-in price (a free-text field such as a wish's "approximate price").
 * A plain number ("18", "18.5", "1,200") is shown as money ("$18.00"); any
 * other text ("$18", "about 20 euros", "10-15") is shown exactly as typed.
 */
export function formatPriceText(
  value: string,
  locale: string,
  currency: string = DEFAULT_CURRENCY,
): string {
  const trimmed = value.trim();
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(trimmed)) return trimmed;
  const amount = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(amount) ? formatMoney(amount, locale, currency) : trimmed;
}
