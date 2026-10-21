import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { TokenPayload } from "@/lib/auth";
import {
  personQueueOwner,
  isQueueOwnerRecoveryEnabled,
} from "@/lib/queue-owner-server";
export const EVENT_PREPARATION_READY_ENV = "FAMILY_EVENT_PREPARATION_READY";
export const eventPreparationReady = () =>
  process.env[EVENT_PREPARATION_READY_ENV] === "1";
export const eventPreparationWritingEnabled = () =>
  eventPreparationReady() && isQueueOwnerRecoveryEnabled();
export function eventPreparationOwner(
  request: NextRequest,
  payload: TokenPayload,
  current: { id: string; family_id: string; role: string },
) {
  if (payload.userId !== current.id || current.role !== "parent") return null;
  const owner = personQueueOwner(request, {
    ...payload,
    family_id: current.family_id,
    role: current.role,
  });
  return owner
    ? {
        ...owner,
        scope: createHash("sha256")
          .update(JSON.stringify(["event-preparation.owner.v1", owner.scope]))
          .digest("hex"),
      }
    : null;
}
