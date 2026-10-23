import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { TokenPayload } from "../auth";
import {
  personQueueOwner,
  isQueueOwnerRecoveryEnabled,
} from "../queue-owner-server";
import { foodPlanningEnabled, type FoodPlanActor } from "./server";
export const foodWritingEnabled = () =>
  foodPlanningEnabled() && isQueueOwnerRecoveryEnabled();
export function foodRequestOwner(
  request: NextRequest,
  payload: TokenPayload,
  current: FoodPlanActor,
) {
  if (
    payload.userId !== current.userId ||
    !["parent", "teen"].includes(current.role)
  )
    return null;
  const owner = personQueueOwner(request, {
    ...payload,
    userId: current.userId,
    family_id: current.familyId,
    role: current.role,
    tv: current.generation,
  });
  return owner
    ? {
        ...owner,
        scope: createHash("sha256")
          .update(JSON.stringify(["food-request.owner.v1", owner.scope]))
          .digest("hex"),
      }
    : null;
}
