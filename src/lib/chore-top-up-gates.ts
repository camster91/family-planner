/** Expand-only source. Both acknowledgements stay off until separately accepted. */
export const FAIR_CHORE_TOP_UP_ENV = "FAIR_CHORE_TOP_UP_ENABLED";
export const FAIR_CHORE_TOP_UP_READY_ENV = "FAIR_CHORE_TOP_UP_ROLLBACK_READY";
export const FAIR_CHORE_TOP_UP_MAX = 100;
export const FAIR_CHORE_TOP_UP_BUDGET_MS = 1500;
export function isFairChoreTopUpEnabled() {
  return process.env[FAIR_CHORE_TOP_UP_ENV] === "1" &&
    process.env[FAIR_CHORE_TOP_UP_READY_ENV] === "1";
}
