import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { inventoryRecoveryReviewInput } from "@/lib/inventory-recovery-review-contract";
import { INVENTORY_RECOVERY_OWNER_HEADER } from "@/lib/inventory-recovery-contract";
import {
  inventoryRecoveryOwner,
  refuseInventoryRecoveryOwner,
} from "@/lib/inventory-recovery-server";
import { reviewInventoryRecovery } from "@/lib/inventory-recovery-review";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { storageBackend } from "@/lib/storage-backend";
import { checkD1RateLimit } from "@/lib/cloudflare/rate-limit";
import { getD1Database } from "@/lib/cloudflare/database";
import { reviewD1InventoryRecovery } from "@/lib/cloudflare/inventory-recovery";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string) =>
  NextResponse.json({ error: { code } }, { status, headers });
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", headers["Cache-Control"]);
      return error;
    }
    if (!request.headers.has(INVENTORY_RECOVERY_OWNER_HEADER))
      return fail(409, "INVENTORY_RECOVERY_OWNER_REQUIRED");
    const refusal = refuseInventoryRecoveryOwner(
      request,
      auth.payload,
      auth.user,
    );
    if (refusal) return refusal;
    const owner = inventoryRecoveryOwner(request, auth.payload, auth.user);
    if (!owner) return fail(409, "INVENTORY_RECOVERY_OWNER_CHANGED");
    if (storageBackend() !== "d1" &&
      !(
        await checkRateLimit(
          `inventory-recovery-review:${auth.user.id}`,
          60,
          60_000,
        )
      ).allowed
    )
      return fail(429, "RATE_LIMITED");
    let body: unknown;
    try {
      body = JSON.parse(await boundedRequestText(request, 32768));
    } catch (error) {
      return fail(
        error instanceof RequestBodyTooLarge ? 413 : 400,
        "INVALID_RECOVERY_REVIEW",
      );
    }
    const input = inventoryRecoveryReviewInput.safeParse(body);
    if (!input.success) return fail(400, "INVALID_RECOVERY_REVIEW");
    if (storageBackend() === "d1") {
      const actor = {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: auth.user.role,
        generation: auth.payload.tv ?? 0,
      };
      const database = await getD1Database();
      if (!(await checkD1RateLimit(database, `inventory-recovery-review:${actor.userId}`, 60, 60_000, Date.now())).allowed)
        return fail(429, "RATE_LIMITED");
      const result = await reviewD1InventoryRecovery(actor, input.data.entry, owner.scope, database);
      return NextResponse.json(result.body, { status: result.status, headers });
    }
    const result = await reviewInventoryRecovery(
      prisma!,
      {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        tokenVersion: auth.payload.tv ?? 0,
      },
      input.data.entry,
      owner.scope,
    );
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (error) {
    logRouteError("inventory recovery review", error, getRequestId(request));
    return fail(500, "INVENTORY_RECOVERY_UNAVAILABLE");
  }
}
