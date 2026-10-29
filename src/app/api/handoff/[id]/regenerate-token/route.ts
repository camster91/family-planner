import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  authenticateWithFamily,
  requireFamilyMatch,
  requireParent,
} from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { featureGate } from "@/lib/feature-gate-server";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { shareExpiry } from "@/lib/handoff-share";
import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import { regenerateD1HandoffToken } from "@/lib/cloudflare/handoffs";
import { D1PersonReceiptError } from "@/lib/cloudflare/person-effect";
import { idempotencyError, readIdempotencyKey } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

// POST /api/handoff/[id]/regenerate-token - Generate new share token (parent only)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const deviceRefusal = await refusePairedDevice(request);
    if (deviceRefusal) return deviceRefusal;

    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const gate = await featureGate(auth.user.family_id, "handoff");
    if (gate) return gate;

    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;

    const { id } = await params;

    if (storageBackend() === "d1") {
      const { key, error: keyError } = readIdempotencyKey(request);
      if (keyError) return keyError;
      const result = await regenerateD1HandoffToken(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          generation: auth.payload.tv ?? 0,
        },
        id,
        key,
        await getD1Database(),
      );
      return NextResponse.json(result.body, {
        status: result.status,
        headers: {
          "Cache-Control": "private, no-store",
          ...(result.replayed ? { "Idempotency-Replayed": "true" } : {}),
        },
      });
    }

    const existing = await prisma!.handoff.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const matchError = requireFamilyMatch(
      existing.family_id,
      auth.user.family_id,
    );
    if (matchError) return matchError;

    // Generate new token:32 hex chars (16 bytes)
    const newToken = randomBytes(16).toString("hex");
    // Same expiry rule as create: 6h after the planned departure (at least 6h
    // from now, at most 7 days), so re-sharing an advance handoff still works.
    const expiresAt = shareExpiry(existing.departure_time);

    const handoff = await prisma!.handoff.update({
      where: { id },
      data: {
        share_token: newToken,
        share_expires_at: expiresAt,
      },
    });

    return NextResponse.json({ handoff });
  } catch (err) {
    if (err instanceof D1PersonReceiptError) return idempotencyError(err.code);
    logRouteError(
      "POST /api/handoff/[id]/regenerate-token",
      err,
      getRequestId(request),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
