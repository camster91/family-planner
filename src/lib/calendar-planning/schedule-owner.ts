import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { TokenPayload } from "@/lib/auth";
import {
  personQueueOwner,
  isQueueOwnerRecoveryEnabled,
} from "@/lib/queue-owner-server";
export const SCHEDULE_REVIEW_READY_ENV = "FAMILY_SCHEDULE_REVIEW_READY";
export const scheduleReviewReady = () =>
  process.env[SCHEDULE_REVIEW_READY_ENV] === "1";
export const scheduleReviewWritingEnabled = () =>
  scheduleReviewReady() && isQueueOwnerRecoveryEnabled();
export function scheduleReviewOwner(
  request: NextRequest,
  payload: TokenPayload,
  current: { id: string; family_id: string; role: string },
) {
  if (
    payload.userId !== current.id ||
    !["parent", "teen", "child"].includes(current.role)
  )
    return null;
  const owner = personQueueOwner(request, {
    ...payload,
    family_id: current.family_id,
    role: current.role,
  });
  return owner
    ? {
        ...owner,
        scope: createHash("sha256")
          .update(JSON.stringify(["schedule-review.owner.v1", owner.scope]))
          .digest("hex"),
      }
    : null;
}
