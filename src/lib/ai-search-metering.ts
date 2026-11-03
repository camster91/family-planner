/** Shared D1/PostgreSQL admission and settlement; no provider activation here. */
import type { AiUsagePolicy, ProviderUsageStart } from "./ai-usage-contract";
import { estimateAiMicrousd } from "./ai-usage-contract";
import { googleRecipeSearchCost, googleRecipeSearchPricing, googleRecipeSearchReservation, type GoogleRecipeSearchPricing } from "./google-recipe-search-cost";
import { AiUsageError } from "./ai-usage-errors";

export function reserveProviderCost(input: ProviderUsageStart, policy: AiUsagePolicy, model: string) {
  if (!input.search) return {
    reserved: estimateAiMicrousd(input.inputBytes + 1024, input.maxOutputTokens, policy),
    searchPricing: null,
  };
  const parsed = googleRecipeSearchPricing.safeParse(input.search.pricing);
  // Search requires current verified token pricing AND an explicit budget.
  // The route must supply approved search rates, never the browser/provider.
  if (!parsed.success || parsed.data.model !== model ||
      policy.monthlyBudgetMicrousd === null ||
      parsed.data.inputMicrousdPerMillion !== policy.inputRateMicrousdPerMillion ||
      parsed.data.outputMicrousdPerMillion !== policy.outputRateMicrousdPerMillion)
    throw new AiUsageError("AI_PRICE_UNAVAILABLE");
  try {
    return {
      reserved: googleRecipeSearchReservation(input.inputBytes + 1024, input.maxOutputTokens, input.search.queryAllowance, parsed.data),
      searchPricing: Object.freeze(parsed.data),
    };
  } catch {
    throw new AiUsageError("AI_PRICE_UNAVAILABLE");
  }
}

export function settleProviderCost(
  usage: { inputTokens: number | null; outputTokens: number | null; searchQueries: number | null; grounded: boolean | null },
  policy: AiUsagePolicy,
  searchPricing: GoogleRecipeSearchPricing | null,
): string | null {
  if (searchPricing) {
    try { return googleRecipeSearchCost(usage, searchPricing).totalMicrousd; }
    catch { return null; } // Retain the original reservation for malformed usage.
  }
  return usage.inputTokens === null || usage.outputTokens === null ? null :
    estimateAiMicrousd(usage.inputTokens, usage.outputTokens, policy);
}
