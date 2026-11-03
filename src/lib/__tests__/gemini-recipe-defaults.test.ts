import {
  defaultGeminiRecipePricing,
  withGeminiRecipeDefaults,
  GEMINI_PRICING_REVIEW_UNTIL,
} from "../gemini-recipe-defaults";
import { defaultAiUsagePolicy } from "../ai-usage-contract";
const config = {
  apiKey: "fabricated-key",
  model: "gemini-3.8-flash",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  userSuppliedUrl: true,
};
const now = Date.parse("2026-11-03T00:00:00Z");
it("prices both tokens and searches without assuming a free allowance", () => {
  expect(defaultGeminiRecipePricing(config, now)).toMatchObject({
    inputMicrousdPerMillion: "750000",
    outputMicrousdPerMillion: "3750000",
    searchMicrousdPerUnit: "14000",
    searchBilling: "query",
  });
});
it("preserves a household pause and lower spending/count limits", () => {
  expect(
    withGeminiRecipeDefaults(
      {
        ...defaultAiUsagePolicy,
        enabled: false,
        dailyLimit: 2,
        monthlyBudgetMicrousd: "1000000",
      },
      config,
      now,
    ),
  ).toMatchObject({
    enabled: false,
    dailyLimit: 2,
    monthlyBudgetMicrousd: "1000000",
  });
  expect(
    withGeminiRecipeDefaults(defaultAiUsagePolicy, config, now)
      .monthlyBudgetMicrousd,
  ).toBe("5000000");
});
it("refuses stale rates and unknown providers or models", () => {
  expect(
    defaultGeminiRecipePricing(config, Date.parse(GEMINI_PRICING_REVIEW_UNTIL)),
  ).toBeNull();
  expect(
    defaultGeminiRecipePricing({ ...config, model: "unknown" }, now),
  ).toBeNull();
  expect(
    defaultGeminiRecipePricing(
      { ...config, baseUrl: "https://example.com" },
      now,
    ),
  ).toBeNull();
});
