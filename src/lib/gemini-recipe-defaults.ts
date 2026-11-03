import type { CaptureConfig } from "./capture";
import type { AiUsagePolicy } from "./ai-usage-contract";
import type { GoogleRecipeSearchPricing } from "./google-recipe-search-cost";
import { GEMINI_DEFAULT_MODEL, isGeminiBaseUrl } from "./gemini-settings";

/** Standard-tier rates verified November 3, 2026:
 * https://aistudio.google.com/docs/pricing#gemini-3.8-flash
 * No free allowance is assigned to an individual household: a Google project
 * can share its allowance across applications. Review this catalog monthly.
 */
export const GEMINI_PRICING_REVIEW_UNTIL = "2026-12-03T00:00:00.000Z";
export const GEMINI_DEFAULT_MONTHLY_MICROUSD = "5000000";
export function defaultGeminiRecipePricing(
  config: CaptureConfig,
  now = Date.now(),
): GoogleRecipeSearchPricing | null {
  if (
    !Number.isFinite(now) ||
    now >= Date.parse(GEMINI_PRICING_REVIEW_UNTIL) ||
    !isGeminiBaseUrl(config.baseUrl) ||
    config.model !== GEMINI_DEFAULT_MODEL ||
    !config.apiKey
  )
    return null;
  return {
    model: GEMINI_DEFAULT_MODEL,
    inputMicrousdPerMillion: "750000",
    outputMicrousdPerMillion: "3750000",
    searchMicrousdPerUnit: "14000",
    searchBilling: "query",
  };
}

/** Supplies defaults without replacing a household's pause or lower limits. */
export function withGeminiRecipeDefaults(
  policy: AiUsagePolicy,
  config: CaptureConfig,
  now = Date.now(),
): AiUsagePolicy {
  if (process.env.FAMILY_GOOGLE_RECIPE_SEARCH_PRICING) return policy;
  const pricing = defaultGeminiRecipePricing(config, now);
  if (!pricing) return policy;
  return {
    ...policy,
    monthlyBudgetMicrousd:
      policy.monthlyBudgetMicrousd ?? GEMINI_DEFAULT_MONTHLY_MICROUSD,
    inputRateMicrousdPerMillion: pricing.inputMicrousdPerMillion,
    outputRateMicrousdPerMillion: pricing.outputMicrousdPerMillion,
  };
}
