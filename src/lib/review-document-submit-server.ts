import { NextResponse, type NextRequest } from "next/server";
import type { TokenPayload } from "@/lib/auth";
import { isValidIdempotencyKey } from "@/lib/idempotency-key";
import {
  reviewDocumentOwner,
  reviewDocumentWritingEnabled,
} from "@/lib/review-document-owner";
import {
  REVIEW_DOCUMENT_CONTRACT,
  REVIEW_SUBMISSION_TTL_MS,
} from "@/lib/review-document-contract";
import {
  REVIEW_SUBMIT_HEADERS as H,
  reviewSubmitDomain,
  type ReviewSubmitAction,
} from "@/lib/review-document-submit-contract";

/** Optional on legacy canonical endpoints, mandatory on the new dispatch route.
 * Recheck after canonical authentication too, so a household/role change between
 * dispatch and handler cannot inherit the earlier person's authority.
 */
export function guardReviewDocumentSubmission(
  request: NextRequest,
  auth: {
    payload: TokenPayload;
    user: { id: string; family_id: string; role: string };
  },
  action: ReviewSubmitAction,
  required = false,
) {
  const supplied = Object.values(H).some((header) =>
    request.headers.has(header),
  );
  if (!required && !supplied) return null;
  const refuse = (status: number, code: string) =>
    NextResponse.json(
      { error: { code } },
      {
        status,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  if (
    request.headers.get(H.contract) !== REVIEW_DOCUMENT_CONTRACT ||
    request.headers.get(H.action) !== action ||
    !isValidIdempotencyKey(request.headers.get("Idempotency-Key") ?? "")
  )
    return refuse(400, "INVALID_REVIEW_SUBMISSION");
  if (
    (action === "chore.create" || action === "chore.profile.create") &&
    auth.user.role !== "parent"
  )
    return refuse(403, "REVIEW_PARENT_REQUIRED");
  const owner = reviewDocumentOwner(
    request,
    {
      ...auth.payload,
      family_id: auth.user.family_id,
      role: auth.user.role,
    },
    reviewSubmitDomain(action),
  );
  if (
    !owner ||
    owner.ownerId !== auth.user.id ||
    request.headers.get(H.owner) !== owner.scope
  )
    return refuse(409, "REVIEW_OWNER_CHANGED");
  if (!reviewDocumentWritingEnabled())
    return refuse(503, "REVIEW_WRITES_PAUSED");
  const rawExpiry = request.headers.get(H.expires) ?? "";
  const expires = Number(rawExpiry),
    now = Date.now();
  if (
    !/^\d{1,16}$/.test(rawExpiry) ||
    !Number.isSafeInteger(expires) ||
    expires <= now ||
    expires > now + REVIEW_SUBMISSION_TTL_MS + 5 * 60 * 1000
  )
    return refuse(409, "REVIEW_SUBMISSION_EXPIRED");
  return null;
}
