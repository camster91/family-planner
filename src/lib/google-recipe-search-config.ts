import { defaultGeminiRecipePricing } from "./gemini-recipe-defaults";
/** Server-managed, expiring price approval. Never populated from browser input. */
import { z } from "zod";
import type { CaptureConfig } from "./capture";
import { aiConfigHash } from "./ai-usage-hash";
import { googleRecipeSearchPricing } from "./google-recipe-search-cost";
const approval = z
  .object({
    configVersion: z.string().regex(/^[a-f0-9]{64}$/),
    validUntil: z.string().datetime(),
    pricing: googleRecipeSearchPricing,
  })
  .strict();
export function approvedGoogleRecipePricing(
  config: CaptureConfig,
  now = Date.now(),
) {
  if (process.env.FAMILY_GOOGLE_RECIPE_SEARCH_READY === "0") return null;
  const raw = process.env.FAMILY_GOOGLE_RECIPE_SEARCH_PRICING;
  if (!raw) return defaultGeminiRecipePricing(config, now);
  if (raw.length > 4096) return null;
  try {
    const value = approval.parse(JSON.parse(raw));
    const expiry = Date.parse(value.validUntil);
    if (
      !Number.isFinite(now) ||
      expiry <= now ||
      expiry - now > 31 * 86400000 ||
      value.configVersion !== aiConfigHash(config) ||
      value.pricing.model !== config.model
    )
      return null;
    return value.pricing;
  } catch {
    return null;
  }
}
