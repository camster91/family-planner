import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { TokenPayload } from "@/lib/auth";
import {
  personQueueOwner,
  isQueueOwnerRecoveryEnabled,
} from "@/lib/queue-owner-server";
import { weeklyResetReady } from "@/lib/weekly-reset";
export const weeklyResetWritingEnabled = () =>
  weeklyResetReady() && isQueueOwnerRecoveryEnabled();
export function weeklyResetOwner(
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
          .update(JSON.stringify(["weekly-reset.owner.v1", owner.scope]))
          .digest("hex"),
      }
    : null;
}
