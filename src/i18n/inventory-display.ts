/**
 * The compact inventory copy used by the Today/fridge Use Soon region.
 *
 * Keep this namespace separate from the full inventory editor dictionary so
 * the dashboard does not pull scan, recipe and mutation copy into its first
 * client bundle. The full inventory dictionary spreads these messages back in
 * to preserve its existing public keys.
 */
export const inventoryDisplayEnglish = {
  useSoon: "Use soon",
  fridge: "Fridge",
  freezer: "Freezer",
  pantry: "Pantry",
  expiryNone: "No date",
  expiryPast: "Past use-by — don't eat",
  expiryYesterday: "Best before was yesterday",
  expiryAgo: "Best before was {days} days ago",
  expiryUseToday: "Use by today",
  expiryBestToday: "Best before today",
  expiryUseTomorrow: "Use by tomorrow",
  expiryBestTomorrow: "Best before tomorrow",
  expiryUseDays: "Use within {days} days",
  expiryBestDays: "Best before in {days} days",
} as const

export const inventoryDisplaySpanish = {
  useSoon: "Usar pronto",
  fridge: "Refrigerador",
  freezer: "Congelador",
  pantry: "Despensa",
  expiryNone: "Sin fecha",
  expiryPast: "Caducado — no lo comas",
  expiryYesterday: "El consumo preferente fue ayer",
  expiryAgo: "El consumo preferente fue hace {days} días",
  expiryUseToday: "Consumir hasta hoy",
  expiryBestToday: "Consumo preferente: hoy",
  expiryUseTomorrow: "Consumir hasta mañana",
  expiryBestTomorrow: "Consumo preferente: mañana",
  expiryUseDays: "Consumir en {days} días",
  expiryBestDays: "Consumo preferente en {days} días",
} as const

export const inventoryDisplayMessages = {
  en: inventoryDisplayEnglish,
  es: inventoryDisplaySpanish,
} as const

export type InventoryDisplayMessage = keyof typeof inventoryDisplayEnglish
export type InventoryDisplayFeedback =
  | { raw: string }
  | { key: InventoryDisplayMessage; params?: Record<string, string | number> }

function displayFeedback(
  key: InventoryDisplayMessage,
  params?: Record<string, string | number>,
): InventoryDisplayFeedback {
  return { key, ...(params ? { params } : {}) }
}

/** Translate the canonical expiry wording while preserving unknown labels. */
export function expiryFeedback(text: string): InventoryDisplayFeedback {
  const fixed = {
    "No date": "expiryNone",
    "Past use-by — don't eat": "expiryPast",
    "Best before was yesterday": "expiryYesterday",
    "Use by today": "expiryUseToday",
    "Best before today": "expiryBestToday",
    "Use by tomorrow": "expiryUseTomorrow",
    "Best before tomorrow": "expiryBestTomorrow",
  } as const
  if (text in fixed) {
    return displayFeedback(fixed[text as keyof typeof fixed])
  }
  for (const [pattern, key] of [
    [/^Best before was (.+) days ago$/, "expiryAgo"],
    [/^Use within (.+) days$/, "expiryUseDays"],
    [/^Best before in (.+) days$/, "expiryBestDays"],
  ] as const) {
    const match = text.match(pattern)
    if (match) return displayFeedback(key, { days: match[1] })
  }
  return { raw: text }
}
