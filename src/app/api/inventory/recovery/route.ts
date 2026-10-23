import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { inventoryIntakeAuthority } from "@/lib/inventory-intake";
import { INVENTORY_RECOVERY_CONTRACT } from "@/lib/inventory-recovery-contract";
import {
  inventoryRecoveryEnabled,
  inventoryRecoveryOwner,
} from "@/lib/inventory-recovery-server";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { checkRateLimit } from "@/lib/rate-limit-db";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  try {
    // Refuses paired-device context before person cookies. No shared journal.
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", headers["Cache-Control"]);
      return error;
    }
    if (
      !(await checkRateLimit(`inventory-recovery:${auth.user.id}`, 240, 60_000))
        .allowed
    )
      return NextResponse.json(
        { error: { code: "RATE_LIMITED" } },
        { status: 429, headers },
      );
    const refusal = await prisma!.$transaction((tx) =>
      inventoryIntakeAuthority(tx, {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        tokenVersion: auth.payload.tv ?? 0,
      }),
    );
    if (refusal)
      return NextResponse.json(refusal.body, {
        status: refusal.status,
        headers,
      });
    const owner = inventoryRecoveryOwner(request, auth.payload, auth.user);
    return NextResponse.json(
      {
        contract: INVENTORY_RECOVERY_CONTRACT,
        enabled: inventoryRecoveryEnabled() && owner !== null,
        owner,
        userId: auth.user.id,
        familyId: auth.user.family_id,
      },
      { headers },
    );
  } catch (error) {
    logRouteError("inventory recovery", error, getRequestId(request));
    return NextResponse.json(
      { error: { code: "INVENTORY_RECOVERY_UNAVAILABLE" } },
      { status: 500, headers },
    );
  }
}
