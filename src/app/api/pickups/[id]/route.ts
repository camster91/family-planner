import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import { refusePairedDevice } from "@/lib/device-refusal";
import { prisma } from "@/lib/prisma";
import { featureGate } from "@/lib/feature-gate-server";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { storageBackend } from "@/lib/storage-backend";
import { authenticateWithFamily } from "@/lib/api-auth";
import { getD1Database } from "@/lib/cloudflare/database";
import { deleteD1Pickup, updateD1Pickup } from "@/lib/cloudflare/pickups";
import { D1PersonReceiptError } from "@/lib/cloudflare/person-effect";

type SessionUser = {
  id: string;
  email: string;
  role?: string;
  family_id?: string | null;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (storageBackend() === "d1") {
      const [auth, error] = await authenticateWithFamily(
        request as NextRequest,
      );
      if (error) return error;
      const { id } = await params;
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return NextResponse.json(
          { error: "Request body must be a JSON object" },
          { status: 400 },
        );
      const completed =
        "completed" in raw && typeof raw.completed === "boolean"
          ? raw.completed
          : undefined;
      const result = await updateD1Pickup(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          generation: auth.payload.tv ?? 0,
        },
        id,
        completed,
        await getD1Database(),
      );
      return NextResponse.json(result.body, {
        status: result.status,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const deviceRefusal = await refusePairedDevice(request as NextRequest);
    if (deviceRefusal) return deviceRefusal;

    const { id } = await params;
    const user = (await getServerUser()) as SessionUser | null;
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const gate = await featureGate(user.family_id, "pickups");
    if (gate) return gate;
    if (!user.family_id)
      return NextResponse.json({ error: "No family" }, { status: 400 });

    const existing = await prisma!.pickup.findUnique({
      where: { id },
      select: { family_id: true },
    });
    if (!existing || existing.family_id !== user.family_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let body: { completed?: unknown } | null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }

    const updated = await prisma!.pickup.update({
      where: { id },
      data: {
        completed:
          typeof body.completed === "boolean" ? body.completed : undefined,
        completed_at:
          typeof body.completed === "boolean"
            ? body.completed
              ? new Date()
              : null
            : undefined,
      },
    });
    return NextResponse.json({ pickup: updated });
  } catch (err) {
    if (err instanceof D1PersonReceiptError)
      return NextResponse.json({ error: err.code }, { status: 409 });
    logRouteError("PATCH /api/pickups/[id]", err, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (storageBackend() === "d1") {
      const [auth, error] = await authenticateWithFamily(
        request as NextRequest,
      );
      if (error) return error;
      const { id } = await params;
      const result = await deleteD1Pickup(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          generation: auth.payload.tv ?? 0,
        },
        id,
        await getD1Database(),
      );
      return NextResponse.json(result.body, {
        status: result.status,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const deviceRefusal = await refusePairedDevice(request as NextRequest);
    if (deviceRefusal) return deviceRefusal;

    const { id } = await params;
    const user = (await getServerUser()) as SessionUser | null;
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const gate = await featureGate(user.family_id, "pickups");
    if (gate) return gate;
    if (!user.family_id)
      return NextResponse.json({ error: "No family" }, { status: 400 });

    const existing = await prisma!.pickup.findUnique({
      where: { id },
      select: { family_id: true },
    });
    if (!existing || existing.family_id !== user.family_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // D9 (#102): any member may create or complete a pickup; deleting one is
    // parent-only.
    if (user.role !== "parent") {
      return NextResponse.json({ error: "Parents only" }, { status: 403 });
    }

    await prisma!.pickup.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof D1PersonReceiptError)
      return NextResponse.json({ error: err.code }, { status: 409 });
    logRouteError("DELETE /api/pickups/[id]", err, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
