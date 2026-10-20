import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { TokenPayload } from "@/lib/auth";
import type { QueueOwner } from "@/lib/queue-owner-contract";
import {
  personQueueOwner,
  isQueueOwnerRecoveryEnabled,
} from "@/lib/queue-owner-server";
import { isRoutineScheduleExpansionEnabled } from "@/lib/routine-schedule-gates";
export function routineScheduleOwner(
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
          .update(JSON.stringify(["routine-recovery.owner.v1", owner.scope]))
          .digest("hex"),
      }
    : null;
}
export function routineRecoveryWritingEnabled() {
  return isQueueOwnerRecoveryEnabled() && isRoutineScheduleExpansionEnabled();
}
/** Separate owner location, still covered by normal generation/household retirement. */
export function routineDraftOwner(owner: QueueOwner | null): QueueOwner | null {
  return owner
    ? {
        ...owner,
        scope: createHash("sha256")
          .update(JSON.stringify(["routine-draft.owner.v1", owner.scope]))
          .digest("hex"),
      }
    : null;
}

/** Independent requests never share a physical journal with stack requests. */
export function routineIndependentOwner(
  owner: QueueOwner | null,
): QueueOwner | null {
  return owner
    ? {
        ...owner,
        scope: createHash("sha256")
          .update(JSON.stringify(["routine-independent.owner.v1", owner.scope]))
          .digest("hex"),
      }
    : null;
}
