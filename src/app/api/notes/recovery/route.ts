import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { prisma } from "@/lib/prisma";
import { authorizeContentWriteInTx } from "@/lib/person-content-authority";
import { NOTE_CREATE_RECOVERY_CONTRACT } from "@/lib/note-create-recovery-identity";
import { noteRecoveryEnabled, noteRecoveryOwner } from "@/lib/note-create-recovery-server";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { storageBackend } from "@/lib/storage-backend";
import { readD1NoteRecovery } from "@/lib/cloudflare/notes-projects";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: NextRequest) {
  try {
    const refused = await refusePairedDevice(request);
    if (refused) { refused.headers.set("Cache-Control", "private, no-store"); return refused; }
    const [auth, error] = await authenticateWithFamily(request);
    if (error) { error.headers.set("Cache-Control", "private, no-store"); return error; }
    if (!(await checkRateLimit(`note-recovery:${auth.user.id}`, 240, 60000)).allowed) return reply({ error: { code: "RATE_LIMITED" } }, 429);
    const owner = noteRecoveryOwner(request, auth.payload, auth.user);
    if (storageBackend() === "d1") {
      const result = await readD1NoteRecovery({
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: auth.user.role,
        generation: auth.payload?.tv ?? 0,
      }, { enabled: noteRecoveryEnabled() && owner !== null, owner });
      return reply(result.body, result.status);
    }
    const denied = await prisma!.$transaction(tx => authorizeContentWriteInTx(tx, {
      userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload?.tv ?? 0,
    }, "notes"));
    if (denied) return reply(denied.body, denied.status);
    return reply({ contract: NOTE_CREATE_RECOVERY_CONTRACT, enabled: noteRecoveryEnabled() && owner !== null,
      owner, userId: auth.user.id, familyId: auth.user.family_id });
  } catch (error) {
    logRouteError("GET /api/notes/recovery", error, getRequestId(request));
    return reply({ error: { code: "NOTE_RECOVERY_UNAVAILABLE" } }, 500);
  }
}
