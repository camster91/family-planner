/** Additive compact read contract. Completeness refers to these bounded source
 * collections at read time, not a consistent database snapshot or profile parity. */
export const ANALYTICS_SUMMARY_PROJECTION = "summary-v1";
export const ANALYTICS_WINDOW_DAYS = 90;
export const MAX_ANALYTICS_CHORES = 5000;
export const ANALYTICS_SUMMARY_LIMIT_CODE = "ANALYTICS_SUMMARY_LIMIT";
export const ANALYTICS_SUMMARY_COVERAGE = Object.freeze({
  kind: "complete", windowDays: ANALYTICS_WINDOW_DAYS, rowLimit: MAX_ANALYTICS_CHORES,
});
export function hasCompleteAnalyticsCoverage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const coverage = value as Record<string, unknown>;
  return coverage.kind === "complete" && coverage.windowDays === ANALYTICS_WINDOW_DAYS &&
    coverage.rowLimit === MAX_ANALYTICS_CHORES;
}
export class AnalyticsSummaryLimitError extends Error {
  constructor() { super("Analytics summary exceeds its supported window size"); this.name = "AnalyticsSummaryLimitError"; }
}
