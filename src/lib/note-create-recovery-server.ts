/** Separate note journal namespace, sharing current session/generation retirement. */
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { TokenPayload } from "./auth";
import { personQueueOwner, isQueueOwnerRecoveryEnabled } from "./queue-owner-server";
import { NOTE_CREATE_RECOVERY_OWNER_HEADER } from "./note-create-recovery-identity";
type Current = { id: string; family_id: string; role: string };
export function noteRecoveryAdopted() { return process.env.NOTE_CREATE_RECOVERY_ROLLBACK_READY === "1"; }
export function noteRecoveryEnabled() {
  return isQueueOwnerRecoveryEnabled() && process.env.NOTE_CREATE_RECOVERY_ENABLED === "1" && process.env.NOTE_CREATE_RECOVERY_ROLLBACK_READY === "1";
}
export function noteRecoveryOwner(request: NextRequest, payload: TokenPayload, current: Current) {
  if (payload.userId !== current.id || !["parent", "teen", "child"].includes(current.role)) return null;
  const owner = personQueueOwner(request, { ...payload, family_id: current.family_id, role: current.role });
  return owner ? { ...owner, scope: createHash("sha256").update(JSON.stringify(["note-create-recovery.owner.v1", owner.scope])).digest("hex") } : null;
}
/** Optional legacy compatibility. Supplied proof is always enforced; paused reads remain possible. */
export function refuseNoteRecoveryOwner(request: NextRequest, payload: TokenPayload, current: Current, write = false) {
  const supplied = request.headers.get(NOTE_CREATE_RECOVERY_OWNER_HEADER);
  if (supplied === null) return null;
  const owner = noteRecoveryOwner(request, payload, current);
  const code = !owner || owner.scope !== supplied ? "NOTE_RECOVERY_OWNER_CHANGED" : write && !noteRecoveryEnabled() ? "NOTE_RECOVERY_PAUSED" : null;
  return code ? NextResponse.json({ error: { code, retryable: false } }, { status: 409, headers: { "Cache-Control": "private, no-store" } }) : null;
}
