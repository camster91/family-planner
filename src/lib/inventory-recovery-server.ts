import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { TokenPayload } from "@/lib/auth";
import {
  personQueueOwner,
  isQueueOwnerRecoveryEnabled,
} from "@/lib/queue-owner-server";
import { INVENTORY_RECOVERY_OWNER_HEADER } from "@/lib/inventory-recovery-contract";

/** Separate scope/key from grocery journals, with the same retirement generation. */
type CurrentActor = { id: string; family_id: string; role: string };
export function inventoryRecoveryOwner(
  request: NextRequest,
  payload: TokenPayload,
  current: CurrentActor,
) {
  if (payload.userId !== current.id) return null;
  const owner = personQueueOwner(request, {
    ...payload,
    family_id: current.family_id,
    role: current.role,
  });
  return owner
    ? {
        ...owner,
        scope: createHash("sha256")
          .update(JSON.stringify(["inventory-recovery.owner.v1", owner.scope]))
          .digest("hex"),
      }
    : null;
}
export function inventoryRecoveryEnabled() {
  return (
    isQueueOwnerRecoveryEnabled() &&
    process.env.INVENTORY_RECOVERY_ENABLED === "1" &&
    process.env.INVENTORY_RECOVERY_ROLLBACK_READY === "1"
  );
}
/** Optional legacy compatibility; supplied proof is always enforced through rollback. */
export function refuseInventoryRecoveryOwner(
  request: NextRequest,
  payload: TokenPayload,
  current: CurrentActor,
) {
  const supplied = request.headers.get(INVENTORY_RECOVERY_OWNER_HEADER);
  if (supplied === null) return null;
  const owner = inventoryRecoveryOwner(request, payload, current);
  return owner && supplied === owner.scope
    ? null
    : NextResponse.json(
        { error: { code: "INVENTORY_RECOVERY_OWNER_CHANGED" } },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
}
