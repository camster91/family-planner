import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { TokenPayload } from "../auth";
import {
  personQueueOwner,
  isQueueOwnerRecoveryEnabled,
} from "../queue-owner-server";
export function prepRecoveryEnabled() {
  return (
    process.env.FAMILY_MEAL_PREP_RECOVERY_READY === "1" &&
    isQueueOwnerRecoveryEnabled()
  );
}
export function prepRequestOwner(request: NextRequest, payload: TokenPayload) {
  if (!["parent", "teen"].includes(payload.role ?? "")) return null;
  const owner = personQueueOwner(request, payload);
  return owner
    ? {
        ...owner,
        scope: createHash("sha256")
          .update(JSON.stringify(["meal-prep.owner.v1", owner.scope]))
          .digest("hex"),
      }
    : null;
}
