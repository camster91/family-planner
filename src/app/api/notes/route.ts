import {
  assistantSourceGuard,
  AssistantSourceRefused,
} from "@/lib/assistant-source-proof";
import { readIdempotencyKey, withIdempotency } from "@/lib/idempotency";
import {
  createPersonNote,
  authorizeContentCreateReplay,
} from "@/lib/person-content-create";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { createNoteSchema } from "@/lib/validations";
import { refusePairedDevice } from "@/lib/device-route";

export const dynamic = "force-dynamic";

function notePermissions(role: string, userId: string, createdBy: string) {
  return {
    can_edit: role === "parent" || createdBy === userId,
    can_delete: role === "parent",
  };
}

// GET - List all pinned notes for the user's family
export async function GET(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;

    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "notes");
    if (gate) return gate;

    const notes = await prisma!.pinnedNote.findMany({
      where: { family_id: auth.user.family_id },
      orderBy: { created_at: "desc" },
    });

    return NextResponse.json({
      notes: notes.map((note) => ({
        ...note,
        ...notePermissions(auth.user.role, auth.user.id, note.created_by),
      })),
    });
  } catch (err) {
    logRouteError("GET /api/notes", err, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST - Create a new note
export async function POST(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;

    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "notes");
    if (gate) return gate;

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = createNoteSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload?.tv ?? 0,
    };
    const sourceGuard = assistantSourceGuard(request, actor, "note_create");
    return await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${actor.userId}`,
        familyId: actor.familyId,
        userId: actor.userId,
        action: "note.create",
      },
      parsed.data,
      ({ recordId }) =>
        createPersonNote(prisma!, parsed.data, actor, recordId, sourceGuard),
      {
        beforeReplay: () =>
          authorizeContentCreateReplay(prisma!, actor, "notes"),
      },
    );
  } catch (err) {
    if (err instanceof AssistantSourceRefused) return err.response();
    logRouteError("POST /api/notes", err, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
