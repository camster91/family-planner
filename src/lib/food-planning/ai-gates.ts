import { isAiUsageReady } from "../ai-usage-gates";
import { foodPlanningEnabled } from "./server";
export function foodAiEnabled() {
  return (
    process.env.FAMILY_FOOD_AI_READY === "1" &&
    foodPlanningEnabled() &&
    isAiUsageReady() &&
    process.env.FAMILY_AI_PROVIDER_DISABLED !== "1"
  );
}
