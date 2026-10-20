/** GS1 modulo-10 identity. Never parse expiry, package weight or price from a retail code. */
export type FoodBarcodeFormat =
  "auto" | "ean_8" | "ean_13" | "upc_a" | "upc_e" | "gtin_14";
export function validGtin(code: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code) || /^0+$/.test(code))
    return false;
  let sum = 0;
  for (
    let i = code.length - 2, weight = 3;
    i >= 0;
    i--, weight = weight === 3 ? 1 : 3
  )
    sum += Number(code[i]) * weight;
  return (10 - (sum % 10)) % 10 === Number(code.at(-1));
}
function expandUpce(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [ns, a, b, c, d, e, last, check] = code;
  const full =
    Number(last) <= 2
      ? `${ns}${a}${b}${last}0000${c}${d}${e}${check}`
      : last === "3"
        ? `${ns}${a}${b}${c}00000${d}${e}${check}`
        : last === "4"
          ? `${ns}${a}${b}${c}${d}00000${e}${check}`
          : `${ns}${a}${b}${c}${d}${e}0000${last}${check}`;
  return validGtin(full) ? full : null;
}
export type FoodBarcode = {
  code: string;
  gtin: string;
  format: Exclude<FoodBarcodeFormat, "auto">;
  restricted: boolean;
};
export function normalizeFoodBarcode(
  raw: string,
  hint: FoodBarcodeFormat = "auto",
): FoodBarcode | null {
  if (raw.length > 40) return null;
  const code = raw.trim().replace(/[ -]/g, "");
  const format =
    hint === "auto"
      ? ({ 12: "upc_a", 13: "ean_13", 14: "gtin_14" } as const)[
          code.length as 12 | 13 | 14
        ]
      : hint;
  // Eight digits need explicit EAN-8/UPC-E intent, never an inferred number system.
  if (!format) return null;
  const lengths = { ean_8: 8, ean_13: 13, upc_a: 12, upc_e: 8, gtin_14: 14 };
  if (code.length !== lengths[format] || !/^\d+$/.test(code)) return null;
  const full =
    format === "upc_e" ? expandUpce(code) : validGtin(code) ? code : null;
  if (!full) return null;
  const gtin = full.padStart(14, "0");
  const ean = gtin.slice(1);
  return {
    code,
    gtin,
    format,
    restricted:
      gtin.startsWith("9") ||
      /^2\d/.test(ean) ||
      /^0[245]/.test(ean) ||
      (gtin.startsWith("000000") && /^[02]/.test(gtin.slice(-8))) ||
      (format === "upc_e" && code.startsWith("1")),
  };
}
