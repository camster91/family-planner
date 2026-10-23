/** Shared browser-safe values for the review-first calendar import flow. */

/** Matches EVENT_IMPORT_UNDO_WINDOW_MS on the server. */
export const IMPORT_UNDO_WINDOW_MS = 10 * 60 * 1000;

/** What the commit route returns (201, or replayed with the same body). */
export interface ImportCommitResult {
  eventIds: string[];
  count: number;
  undoToken: string;
  undoExpiresAt: string;
}
