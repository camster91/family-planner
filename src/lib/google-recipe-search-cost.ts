/**
 * Search-inclusive pricing for a future native Google discovery adapter.
 * Not an activation switch or a provider spending cap. Rates must be verified
 * for the configured model; no shared/free allowance is assumed per household.
 */
import { z } from "zod";

const rate = z.string().regex(/^(0|[1-9][0-9]{0,9})$/);
const count = z.number().int().min(0).max(100_000_000);
export const googleRecipeSearchPricing = z.object({
  model: z.string().min(1).max(120),
  inputMicrousdPerMillion: rate,
  outputMicrousdPerMillion: rate,
  searchMicrousdPerUnit: rate,
  searchBilling: z.enum(["query", "grounded-request"]),
}).strict();
export type GoogleRecipeSearchPricing = z.infer<typeof googleRecipeSearchPricing>;

export const googleRecipeSearchUsage = z.object({
  // Include provider-billed tool/context input and thinking output when the
  // selected API exposes them. Missing/partial usage must remain unknown.
  inputTokens: count.nullable(),
  outputTokens: count.nullable(),
  searchQueries: z.number().int().min(0).max(10000).nullable(),
  grounded: z.boolean().nullable(),
}).strict();
export type GoogleRecipeSearchUsage = z.infer<typeof googleRecipeSearchUsage>;

/** Integer micro-USD; null means unknown, never free. No content is retained. */
export function googleRecipeSearchCost(
  usage: GoogleRecipeSearchUsage,
  pricing: GoogleRecipeSearchPricing,
): { tokenMicrousd: string | null; searchMicrousd: string | null; totalMicrousd: string | null } {
  const u = googleRecipeSearchUsage.parse(usage);
  const p = googleRecipeSearchPricing.parse(pricing);
  const tokens = u.inputTokens === null || u.outputTokens === null ? null :
    (BigInt(u.inputTokens) * BigInt(p.inputMicrousdPerMillion) +
      BigInt(u.outputTokens) * BigInt(p.outputMicrousdPerMillion) + BigInt("999999")) / BigInt("1000000");
  // Never deduplicate reported queries: repeated searches can still be billed.
  const units = p.searchBilling === "query" ? u.searchQueries :
    u.grounded === null ? null : u.grounded ? 1 : 0;
  const searches = units === null ? null : BigInt(units) * BigInt(p.searchMicrousdPerUnit);
  return {
    tokenMicrousd: tokens?.toString() ?? null,
    searchMicrousd: searches?.toString() ?? null,
    totalMicrousd: tokens === null || searches === null ? null : (tokens + searches).toString(),
  };
}

/**
 * Admission estimate only. The caller must retain it for unknown outcomes and
 * settle actual query usage. A locally chosen query allowance cannot enforce
 * the number of searches performed inside a provider request.
 */
export function googleRecipeSearchReservation(
  inputTokens: number,
  maxOutputTokens: number,
  searchQueryAllowance: number,
  pricing: GoogleRecipeSearchPricing,
): string {
  if (!Number.isSafeInteger(searchQueryAllowance) || searchQueryAllowance < 1)
    throw new Error("Search reservation requires a positive allowance");
  const total = googleRecipeSearchCost({
    inputTokens, outputTokens: maxOutputTokens,
    searchQueries: searchQueryAllowance, grounded: true,
  }, pricing).totalMicrousd;
  if (total === null) throw new Error("Search pricing unavailable");
  return total;
}
