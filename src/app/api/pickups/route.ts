import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/supabase/server";
import { refusePairedDevice } from "@/lib/device-refusal";
import { prisma } from "@/lib/prisma";
import { featureGate } from "@/lib/feature-gate-server";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { createPickupSchema } from "@/lib/validations";
import { storageBackend } from "@/lib/storage-backend";
import { authenticateWithFamily } from "@/lib/api-auth";
import { getD1Database } from "@/lib/cloudflare/database";
import { readD1Pickups, createD1Pickup } from "@/lib/cloudflare/pickups";
import { D1PersonReceiptError } from "@/lib/cloudflare/person-effect";

type SessionUser = {
  id: string;
  email: string;
  role?: string;
  family_id?: string | null;
};

export async function GET(request: NextRequest) {
  if (storageBackend() === "d1") {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const result = await readD1Pickups(
      {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: auth.user.role,
        generation: auth.payload.tv ?? 0,
      },
      await getD1Database(),
    );
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const deviceRefusal = await refusePairedDevice(request);
  if (deviceRefusal) return deviceRefusal;

  const user = (await getServerUser()) as SessionUser | null;
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await featureGate(user.family_id, "pickups");
  if (gate) return gate;
  if (!user.family_id) return NextResponse.json({ pickups: [] });

  const pickups = await prisma!.pickup.findMany({
    where: { family_id: user.family_id },
    include: {
      assignee: { select: { id: true, name: true, avatar_url: true } },
    },
    orderBy: { pickup_time: "asc" },
  });

  return NextResponse.json({
    pickups: pickups.map((p) => ({
      id: p.id,
      title: p.title,
      location: p.location,
      pickup_time: p.pickup_time.toISOString(),
      completed: p.completed,
      completed_at: p.completed_at?.toISOString() || null,
      assigned_to: p.assigned_to,
      assignee_name: p.assignee?.name,
      assignee_avatar: p.assignee?.avatar_url,
      notes: p.notes,
    })),
  });
}

export async function POST(request: Request) {
  try {
    if (storageBackend() === "d1") {
      const [auth, error] = await authenticateWithFamily(
        request as NextRequest,
      );
      if (error) return error;
      let json: unknown;
      try {
        json = await request.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
      const parsed = createPickupSchema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0].message },
          { status: 400 },
        );
      }
      const result = await createD1Pickup(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          generation: auth.payload.tv ?? 0,
        },
        parsed.data,
        await getD1Database(),
      );
      return NextResponse.json(result.body, {
        status: result.status,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const deviceRefusal = await refusePairedDevice(request as NextRequest);
    if (deviceRefusal) return deviceRefusal;

    const user = (await getServerUser()) as SessionUser | null;
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const gate = await featureGate(user.family_id, "pickups");
    if (gate) return gate;
    if (!user.family_id)
      return NextResponse.json({ error: "No family" }, { status: 400 });

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = createPickupSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // An assignee, if given, must be a member of the caller's family.
    if (body.assigned_to) {
      const assignee = await prisma!.user.findFirst({
        where: { id: body.assigned_to, family_id: user.family_id },
        select: { id: true },
      });
      if (!assignee) {
        return NextResponse.json(
          { error: "Assignee must be a member of your family" },
          { status: 400 },
        );
      }
    }

    const created = await prisma!.pickup.create({
      data: {
        family_id: user.family_id,
        created_by: user.id,
        title: body.title,
        location: body.location?.trim() || null,
        pickup_time: new Date(body.pickup_time),
        assigned_to: body.assigned_to || null,
        notes: body.notes?.trim() || null,
      },
    });
    return NextResponse.json({ pickup: created }, { status: 201 });
  } catch (error) {
    if (error instanceof D1PersonReceiptError)
      return NextResponse.json({ error: error.code }, { status: 409 });
    logRouteError("POST /api/pickups", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
