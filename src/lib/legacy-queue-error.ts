/** Recoverable errors raised while explicitly reviewing or migrating legacy queue data. */
export class LegacyQueueError extends Error {
  constructor(
    public readonly reason:
      "UNAVAILABLE" | "DIVERGENT" | "OWNER_CHANGED" | "UPDATE_REQUIRED",
  ) {
    super("Older saved changes could not be confirmed.");
    this.name = "LegacyQueueError";
  }
}
