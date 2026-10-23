import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { TokenPayload } from "@/lib/auth";
import {
  personQueueOwner,
  isQueueOwnerRecoveryEnabled,
} from "@/lib/queue-owner-server";
import type { ReviewDocumentContext } from "@/lib/review-document-contract";

/** Distinct domain locations, same session/household erasure inventory. */
export function reviewDocumentOwner(
  request: NextRequest,
  payload: TokenPayload,
  domain: ReviewDocumentContext["domain"],
) {
  if (payload.role !== "parent" && payload.role !== "teen") return null;
  const owner = personQueueOwner(request, payload);
  return owner
    ? {
        ...owner,
        scope: createHash("sha256")
          .update(
            JSON.stringify(["review-document.owner.v1", domain, owner.scope]),
          )
          .digest("hex"),
      }
    : null;
}
/** Once adopted, keep this on through write pauses until owned data is retired. */
export function reviewDocumentRecoveryAdopted() {
  return process.env.FAMILY_REVIEW_DOCUMENTS_ROLLBACK_READY === "1";
}
export function reviewDocumentWritingEnabled() {
  return (
    isQueueOwnerRecoveryEnabled() &&
    reviewDocumentRecoveryAdopted() &&
    process.env.FAMILY_REVIEW_DOCUMENTS_READY === "1"
  );
}
