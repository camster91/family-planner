import { refuseNoteRecoveryOwner } from "@/lib/note-create-recovery-server";
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { prisma } from "@/lib/prisma";
import { createNoteSchema } from "@/lib/validations";
import { readIdempotencyKey, idempotencyError } from "@/lib/idempotency";
import { inspectPersonNoteReceipt } from "@/lib/person-note-receipt";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { storageBackend } from "@/lib/storage-backend";
import { inspectD1NoteReceipt } from "@/lib/cloudflare/notes-projects";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
/** POST carries original private request bytes for hashing; this endpoint is read-only. */
export async function POST(request: NextRequest) {
  try {
    const refused = await refusePairedDevice(request);
    if (refused) { refused.headers.set("Cache-Control", "private, no-store"); return refused; }
    const [auth, error] = await authenticateWithFamily(request);
    if (error) { error.headers.set("Cache-Control", "private, no-store"); return error; }
    const ownerRefusal = refuseNoteRecoveryOwner(request, auth.payload, auth.user);
    if (ownerRefusal) return ownerRefusal;
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    let json: unknown;
    try { json = await request.json(); } catch { return reply({ error: "Invalid JSON" }, 400); }
    const parsed = createNoteSchema.safeParse(json);
    if (!parsed.success || !parsed.data.expected_user_id || !parsed.data.expected_family_id)
      return reply({ error: "Original owner-bound note request required" }, 400);
    if (storageBackend() === "d1") {
      const result = await inspectD1NoteReceipt({ userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload?.tv ?? 0 }, key, parsed.data);
      return reply(result.body, result.status);
    }
    const result = await inspectPersonNoteReceipt(prisma!, {
      userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload?.tv ?? 0,
    }, key, parsed.data);
    return reply(result.body, result.status);
  } catch (error) {
    logRouteError("POST /api/notes/create/receipt", error, getRequestId(request));
    return reply({ error: "Receipt inspection unavailable" }, 500);
  }
}
