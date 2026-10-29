/** Stable, content-free errors shared by PostgreSQL and native D1 metering. */
export class AiUsageError extends Error {
  readonly status: number;
  constructor(
    readonly code:
      | "AI_USAGE_UNAVAILABLE"
      | "AI_PAUSED"
      | "AI_QUOTA_REACHED"
      | "AI_PRICE_UNAVAILABLE"
      | "AI_SOURCE_CHANGED",
    status = 503,
  ) {
    super(
      code === "AI_PAUSED"
        ? "Household AI is paused. You can still use the app controls."
        : code === "AI_QUOTA_REACHED"
          ? "The household AI limit was reached. Use the app controls or ask a parent to review AI limits."
          : code === "AI_PRICE_UNAVAILABLE"
            ? "AI cost limits need current rates. Ask a parent to review AI usage settings."
            : "AI usage could not be checked. Use the app controls or try again later.",
    );
    this.name = "AiUsageError";
    this.status = status;
  }
}
