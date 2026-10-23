import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { TokenPayload } from "@/lib/auth";
import {
  personQueueOwner,
  isQueueOwnerRecoveryEnabled,
} from "@/lib/queue-owner-server";
export const RESPONSIBILITY_READY_ENV = "FAMILY_RESPONSIBILITY_READY";
export const responsibilityReady = () =>
  process.env[RESPONSIBILITY_READY_ENV] === "1";
export const responsibilityWritingEnabled = () =>
  responsibilityReady() && isQueueOwnerRecoveryEnabled();
export function responsibilityOwner(
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
          .update(JSON.stringify(["responsibility.owner.v1", owner.scope]))
          .digest("hex"),
      }
    : null;
}
