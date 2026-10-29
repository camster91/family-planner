import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import { updateD1Anniversary, deleteD1Anniversary } from "@/lib/cloudflare/anniversaries";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { refusePairedDevice } from "@/lib/device-route";
import { readIdempotencyKey, withIdempotency } from "@/lib/idempotency";
import {
  authorizeAnniversaryReplay,
  deleteAnniversaryWithReceipt,
  projectAnniversaryReplay,
  updateAnniversaryWithReceipt,
} from "@/lib/anniversary-write";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { updateAnniversarySchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH - Update an anniversary. The id comes from the path segment only;
// any `id` in the body is ignored.
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;

    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "anniversaries");
    if (gate) return gate;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { id } = await params;
    const parsed = updateAnniversarySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (storageBackend() === "d1") {
      const { key, error: keyError } = readIdempotencyKey(request);
      if (keyError) return keyError;
      const result = await updateD1Anniversary({
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: auth.user.role,
        generation: auth.payload?.tv ?? 0,
      }, id, parsed.data, key);
      const response = NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
      if (result.replayed) response.headers.set("Idempotency-Replayed", "true");
      return response;
    }

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;

    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: "anniversary.update",
      },
      { id, ...parsed.data },
      ({ recordId }) =>
        updateAnniversaryWithReceipt(
          prisma!,
          id,
          parsed.data,
          { familyId: auth.user.family_id, userId: auth.user.id },
          recordId,
        ),
      {
        beforeReplay: () =>
          authorizeAnniversaryReplay(
            prisma!,
            "update",
            { familyId: auth.user.family_id, userId: auth.user.id },
            id,
            key,
          ),
        transformReplay: (result) =>
          projectAnniversaryReplay(prisma!, result, {
            familyId: auth.user.family_id,
            userId: auth.user.id,
          }),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (err) {
    logRouteError("PATCH /api/anniversaries/[id]", err, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE - Remove an anniversary (id from the path segment)
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;

    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "anniversaries");
    if (gate) return gate;

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (storageBackend() === "d1") {
      const { key, error: keyError } = readIdempotencyKey(request);
      if (keyError) return keyError;
      const result = await deleteD1Anniversary({
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: auth.user.role,
        generation: auth.payload?.tv ?? 0,
      }, id, key);
      const response = NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
      if (result.replayed) response.headers.set("Idempotency-Replayed", "true");
      return response;
    }

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;

    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: "anniversary.delete",
      },
      { id },
      ({ recordId }) =>
        deleteAnniversaryWithReceipt(
          prisma!,
          id,
          { familyId: auth.user.family_id, userId: auth.user.id },
          recordId,
        ),
      {
        beforeReplay: () =>
          authorizeAnniversaryReplay(
            prisma!,
            "delete",
            { familyId: auth.user.family_id, userId: auth.user.id },
            id,
          ),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (err) {
    logRouteError("DELETE /api/anniversaries/[id]", err, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
