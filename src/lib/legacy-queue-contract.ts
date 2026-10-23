import type { QueuedOperation } from "@/lib/offline-queue";
import type { QueueReviewTarget } from "@/lib/queue-review-contract";
export type LegacyQueuePreview = {
  token: string;
  operations: QueuedOperation[];
  targets: Record<string, QueueReviewTarget | null>;
};
/** Every known old row must be kept for review or deliberately discarded. */
export type LegacyQueueDecision = {
  token: string;
  keep: string[];
  discard: string[];
};
