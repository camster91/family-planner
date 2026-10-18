import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { TokenPayload } from "@/lib/auth";
import type { DeviceActor } from "@/lib/device-session";
import {
  QUEUE_OWNER_HEADER,
  type QueueOwner,
} from "@/lib/queue-owner-contract";

export const QUEUE_OWNER_ENABLE_ENV = "QUEUE_OWNER_RECOVERY_ENABLED";
export const QUEUE_OWNER_ROLLBACK_ENV = "QUEUE_OWNER_RECOVERY_ROLLBACK_READY";
export function isQueueOwnerRecoveryEnabled() {
  return (
    process.env[QUEUE_OWNER_ENABLE_ENV] === "1" &&
    process.env[QUEUE_OWNER_ROLLBACK_ENV] === "1"
  );
}
const scope = (parts: unknown[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
/** A hash is continuity metadata only; every action still authenticates normally. */
export function personQueueOwner(
  request: NextRequest,
  payload: TokenPayload,
): QueueOwner | null {
  const token = request.cookies.get("session_token")?.value;
  if (!token || !payload.family_id || !payload.sid) return null;
  return {
    kind: "person",
    ownerId: payload.userId,
    scope: scope([
      "queue-owner.person.v1",
      token,
      payload.family_id,
      payload.role,
      payload.tv ?? 0,
    ]),
  };
}
/** Device refresh rotates access/session tokens; pairing identity stays stable. */
export function deviceQueueOwner(actor: DeviceActor): QueueOwner {
  return {
    kind: "device",
    ownerId: actor.deviceId,
    scope: scope(["queue-owner.device.v1", actor.deviceId, actor.familyId]),
  };
}
/** Called before an idempotent queueable mutation, after canonical auth. */
export function queueOwnerMatches(
  request: NextRequest,
  owner: QueueOwner | null,
) {
  return (
    !isQueueOwnerRecoveryEnabled() ||
    (owner !== null && request.headers.get(QUEUE_OWNER_HEADER) === owner.scope)
  );
}
