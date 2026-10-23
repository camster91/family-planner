/** Private rollout gates. Adoption remains on throughout a write pause. */
export const isAiUsageReady = () =>
  process.env.FAMILY_AI_USAGE_READY === "1" &&
  process.env.FAMILY_AI_USAGE_ROLLBACK_READY === "1";
export const isAiUsageAdopted = () =>
  process.env.FAMILY_AI_USAGE_READY === "1" ||
  process.env.FAMILY_AI_USAGE_ROLLBACK_READY === "1";
